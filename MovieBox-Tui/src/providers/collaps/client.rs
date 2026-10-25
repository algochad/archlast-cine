use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::{Client, StatusCode};
use serde_json::Value;

use super::cinemeta;
use super::embed::{self, CollapsEmbed, CollapsSource};
use crate::models::BrowseMetrics;
use crate::providers::ProviderCapabilities;
use crate::providers::models::{
    CatalogItem, MediaDetails, ProviderError, ProviderKind, Release, SourceMirror, SubtitleOption,
};

const CINEMETA_BASE: &str = "https://v3-cinemeta.strem.io";
const COLLAPS_EMBED_BASE: &str = "https://api.insertunit.ws";
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/// Embed URLs are signed for ~10 days; 10 minutes keeps the streams → play →
/// captions calls of one title on a single embed fetch.
const EMBED_TTL: Duration = Duration::from_secs(10 * 60);
const META_TTL: Duration = Duration::from_secs(60 * 60);
const CACHE_MAX: usize = 512;
/// Cinemeta catalog page size.
const CATALOG_PAGE: usize = 50;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn is_imdb_id(id: &str) -> bool {
    id.len() > 2 && id.starts_with("tt") && id[2..].bytes().all(|b| b.is_ascii_digit())
}

fn current_year() -> i32 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    1970 + (secs / 31_556_952) as i32
}

struct TtlCache<V> {
    ttl: Duration,
    entries: Mutex<HashMap<String, (Instant, V)>>,
}

impl<V: Clone> TtlCache<V> {
    fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entries: Mutex::new(HashMap::new()),
        }
    }

    fn get(&self, key: &str) -> Option<V> {
        let map = self.entries.lock().ok()?;
        let (at, value) = map.get(key)?;
        (at.elapsed() < self.ttl).then(|| value.clone())
    }

    fn insert(&self, key: String, value: V) {
        let Ok(mut map) = self.entries.lock() else {
            return;
        };
        if map.len() >= CACHE_MAX {
            let ttl = self.ttl;
            map.retain(|_, (at, _)| at.elapsed() < ttl);
        }
        if map.len() >= CACHE_MAX {
            if let Some(oldest) = map
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest);
            }
        }
        map.insert(key, (Instant::now(), value));
    }
}

/// Movies & series: metadata from Cinemeta (TMDB/IMDb), streams and
/// subtitles from the Collaps CDN embed, both keyed by IMDb id.
#[derive(Clone)]
pub struct CollapsProvider {
    http: Client,
    cinemeta_base: String,
    embed_base: String,
    /// `None` caches "not on Collaps" so a missing title is not re-fetched
    /// by every streams/play/captions call.
    embeds: Arc<TtlCache<Option<Arc<CollapsEmbed>>>>,
    metas: Arc<TtlCache<Arc<Value>>>,
}

impl CollapsProvider {
    pub fn new(http: Client) -> Self {
        Self {
            http,
            cinemeta_base: env_or("CINEMETA_BASE_URL", CINEMETA_BASE),
            embed_base: env_or("COLLAPS_EMBED_BASE_URL", COLLAPS_EMBED_BASE),
            embeds: Arc::new(TtlCache::new(EMBED_TTL)),
            metas: Arc::new(TtlCache::new(META_TTL)),
        }
    }

    async fn get(&self, url: &str) -> Result<reqwest::Response, ProviderError> {
        let resp = self
            .http
            .get(url)
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;
        match resp.status() {
            s if s.is_success() => Ok(resp),
            StatusCode::NOT_FOUND => Err(ProviderError::NotFound),
            StatusCode::TOO_MANY_REQUESTS => Err(ProviderError::RateLimited(None)),
            s => Err(ProviderError::Unavailable(format!("HTTP {s} from {url}"))),
        }
    }

    async fn get_json(&self, url: &str) -> Result<Value, ProviderError> {
        self.get(url)
            .await?
            .json::<Value>()
            .await
            .map_err(|e| ProviderError::Parsing(e.to_string()))
    }

    /// One Cinemeta catalog page. `extra` pairs become the `/k=v&k=v` path segment.
    async fn catalog(
        &self,
        kind: &str,
        catalog: &str,
        extra: &[(&str, String)],
    ) -> Result<Vec<Value>, ProviderError> {
        let extra = extra
            .iter()
            .map(|(k, v)| format!("{k}={}", urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&");
        let url = if extra.is_empty() {
            format!("{}/catalog/{kind}/{catalog}.json", self.cinemeta_base)
        } else {
            format!(
                "{}/catalog/{kind}/{catalog}/{extra}.json",
                self.cinemeta_base
            )
        };
        let body = self.get_json(&url).await?;
        Ok(body
            .get("metas")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    /// Home feed: two pages each of the top movies and top series, with
    /// per-item metrics for the row builder. Fails only when every catalog does.
    pub async fn homepage(
        &self,
    ) -> Result<(Vec<CatalogItem>, HashMap<String, BrowseMetrics>), ProviderError> {
        let pages = [
            ("movie", 0),
            ("series", 0),
            ("movie", CATALOG_PAGE),
            ("series", CATALOG_PAGE),
        ];
        let results = futures::future::join_all(pages.iter().map(|(kind, skip)| {
            let extra: Vec<(&str, String)> = if *skip == 0 {
                Vec::new()
            } else {
                vec![("skip", skip.to_string())]
            };
            async move { self.catalog(kind, "top", &extra).await }
        }))
        .await;
        let year = current_year();
        let mut items = Vec::new();
        let mut metrics = HashMap::new();
        let mut last_err = None;
        for result in results {
            match result {
                Ok(metas) => {
                    for meta in &metas {
                        if let Some(item) = cinemeta::to_catalog_item(meta) {
                            metrics.insert(item.id.value.clone(), cinemeta::to_metrics(meta, year));
                            items.push(item);
                        }
                    }
                }
                Err(e) => last_err = Some(e),
            }
        }
        match (items.is_empty(), last_err) {
            (true, Some(e)) => Err(e),
            _ => Ok((items, metrics)),
        }
    }

    /// IMDb-id meta. Series is tried first: Cinemeta answers a movie lookup
    /// for a series id with a stub "movie" (no episodes), but a series lookup
    /// for a movie id with `{}`.
    async fn meta(&self, id: &str) -> Result<Arc<Value>, ProviderError> {
        if !is_imdb_id(id) {
            return Err(ProviderError::NotFound);
        }
        if let Some(meta) = self.metas.get(id) {
            return Ok(meta);
        }
        for kind in ["series", "movie"] {
            let url = format!("{}/meta/{kind}/{id}.json", self.cinemeta_base);
            let body = match self.get_json(&url).await {
                Ok(body) => body,
                Err(ProviderError::NotFound) => continue,
                Err(e) => return Err(e),
            };
            // Unknown ids come back as a nameless stub, not a 404.
            if let Some(meta) = body
                .get("meta")
                .filter(|m| cinemeta::to_catalog_item(m).is_some())
            {
                let meta = Arc::new(meta.clone());
                self.metas.insert(id.to_string(), meta.clone());
                return Ok(meta);
            }
        }
        Err(ProviderError::NotFound)
    }

    async fn embed(&self, id: &str) -> Result<Arc<CollapsEmbed>, ProviderError> {
        if !is_imdb_id(id) {
            return Err(ProviderError::NotFound);
        }
        if let Some(cached) = self.embeds.get(id) {
            return cached.ok_or(ProviderError::NotFound);
        }
        let url = format!("{}/embed/imdb/{id}", self.embed_base);
        let html = match self.get(&url).await {
            Ok(resp) => resp
                .text()
                .await
                .map_err(|e| ProviderError::Network(e.to_string()))?,
            Err(ProviderError::NotFound) => {
                self.embeds.insert(id.to_string(), None);
                return Err(ProviderError::NotFound);
            }
            Err(e) => return Err(e),
        };
        let parsed = embed::parse_embed(&html).map(Arc::new);
        if parsed.is_none() {
            log::warn!(
                "collaps: embed for {id} has no playable source ({} bytes)",
                html.len()
            );
        }
        self.embeds.insert(id.to_string(), parsed.clone());
        parsed.ok_or(ProviderError::NotFound)
    }

    /// Subtitle tracks of one movie/episode; empty when the title has none
    /// or is not on Collaps.
    pub async fn captions(&self, id: &str, season: usize, episode: usize) -> Vec<SubtitleOption> {
        match self.embed(id).await {
            Ok(embed) => embed
                .source_for(season, episode)
                .map(embed::subtitle_options)
                .unwrap_or_default(),
            Err(e) => {
                log::debug!("collaps: captions for {id} s={season} e={episode} unavailable: {e}");
                Vec::new()
            }
        }
    }
}

fn release_for(source: &CollapsSource, season: usize, episode: usize, is_series: bool) -> Release {
    let mut languages: Vec<&str> = Vec::new();
    for name in &source.audio {
        let (code, label) = embed::track_language(name);
        if code != "und" && !languages.contains(&label) {
            languages.push(label);
        }
    }
    // The UI already prefixes the provider label.
    let filename = if is_series {
        format!("S{season:02}E{episode:02} · HLS")
    } else {
        "HLS".to_string()
    };
    Release {
        provider: ProviderKind::Collaps,
        filename,
        // Never "multi": the web player reads that as a DASH ladder.
        quality: Some("Auto".to_string()),
        codec: Some("H.264".to_string()),
        language: (!languages.is_empty()).then(|| languages.join(", ")),
        size_bytes: None,
        season: is_series.then_some(season),
        episode: is_series.then_some(episode),
        mirrors: vec![SourceMirror {
            label: "Collaps".to_string(),
            resolver_url: source.hls.clone(),
            headers: vec![("User-Agent".to_string(), USER_AGENT.to_string())],
            direct_file: false,
        }],
        resource_id: None,
    }
}

impl crate::providers::Provider for CollapsProvider {
    fn id(&self) -> ProviderKind {
        ProviderKind::Collaps
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_search: true,
            supports_pagination: false,
            supports_series: true,
            supports_subtitles: true,
            supports_homepage: true,
        }
    }

    /// Movies and series interleaved by Cinemeta rank. Unpaginated upstream.
    async fn search(&self, query: &str, page: usize) -> Result<Vec<CatalogItem>, ProviderError> {
        let query = query.trim();
        if query.is_empty() || page > 1 {
            return Ok(Vec::new());
        }
        let extra = [("search", query.to_string())];
        let (movies, series) = futures::join!(
            self.catalog("movie", "top", &extra),
            self.catalog("series", "top", &extra)
        );
        if let (Err(e), Err(_)) = (&movies, &series) {
            return Err(e.clone());
        }
        let (movies, series) = (movies.unwrap_or_default(), series.unwrap_or_default());
        let mut items = Vec::new();
        for i in 0..movies.len().max(series.len()) {
            for list in [&movies, &series] {
                if let Some(item) = list.get(i).and_then(cinemeta::to_catalog_item) {
                    items.push(item);
                }
            }
        }
        Ok(items)
    }

    async fn details(&self, id: &str) -> Result<MediaDetails, ProviderError> {
        let meta = self.meta(id).await?;
        cinemeta::to_details(&meta)
            .ok_or_else(|| ProviderError::Parsing(format!("unusable Cinemeta meta for {id}")))
    }
}

impl crate::providers::ReleaseProvider for CollapsProvider {
    async fn episode_streams(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        let embed = self.embed(id).await?;
        let source = embed
            .source_for(season, episode)
            .ok_or(ProviderError::NotFound)?;
        let is_series = matches!(*embed, CollapsEmbed::Series(_));
        let (season, episode) = match &*embed {
            CollapsEmbed::Series(seasons) if season == 0 || episode == 0 => {
                // Report the episode actually picked for an unspecified request.
                let s = if season == 0 {
                    seasons.first()
                } else {
                    seasons.iter().find(|s| s.number == season)
                };
                let s = s.ok_or(ProviderError::NotFound)?;
                let e = if episode == 0 {
                    s.episodes.first().map(|e| e.number)
                } else {
                    Some(episode)
                };
                (s.number, e.unwrap_or(1))
            }
            _ => (season, episode),
        };
        Ok(vec![release_for(source, season, episode, is_series)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imdb_id_validation() {
        assert!(is_imdb_id("tt1375666"));
        assert!(!is_imdb_id("tt"));
        assert!(!is_imdb_id("1375666"));
        assert!(!is_imdb_id("tt13/../x"));
    }

    #[test]
    fn release_never_tags_multi_and_lists_languages() {
        let source = CollapsSource {
            hls: "https://cdn.example/master.m3u8".into(),
            audio: vec![
                "Рус. Дублированный".into(),
                "Eng.Original".into(),
                "AlexFilm".into(),
                "Рус. ММ".into(),
            ],
            subtitles: vec![],
        };
        let movie = release_for(&source, 0, 0, false);
        assert!(!movie.is_multi_resolution());
        assert_eq!(movie.language.as_deref(), Some("Russian, English"));
        assert_eq!(movie.season, None);
        assert_eq!(
            movie.mirrors[0].resolver_url,
            "https://cdn.example/master.m3u8"
        );
        let ep = release_for(&source, 2, 5, true);
        assert_eq!(ep.filename, "S02E05 · HLS");
        assert_eq!((ep.season, ep.episode), (Some(2), Some(5)));
    }

    #[test]
    fn ttl_cache_expires_and_bounds() {
        let cache: TtlCache<u32> = TtlCache::new(Duration::from_millis(0));
        cache.insert("a".into(), 1);
        assert_eq!(cache.get("a"), None);
        let cache: TtlCache<u32> = TtlCache::new(Duration::from_secs(60));
        for i in 0..(CACHE_MAX as u32 + 5) {
            cache.insert(i.to_string(), i);
        }
        assert!(cache.entries.lock().unwrap().len() <= CACHE_MAX);
        assert_eq!(
            cache.get(&(CACHE_MAX as u32 + 4).to_string()),
            Some(CACHE_MAX as u32 + 4)
        );
    }
}
