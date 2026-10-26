//! Provider-agnostic operations on [`MovieBoxService`]: viewers deal in titles
//! and IMDb ids, never in sources.
//!
//! * `releases_for`   – streams for any provider; Collaps titles fall back to
//!   MovieBox/4KHDHub when Collaps does not carry them.
//! * `captions_for`   – every provider's native subtitles plus OpenSubtitles
//!   (found through the title's IMDb id), merged and deduplicated.
//! * `imdb_for`       – map a title from any source to its Cinemeta/IMDb entry.

use std::sync::Arc;
use std::time::Duration;

use super::MovieBoxService;
use crate::providers::hub::cache::TtlCache;
use crate::providers::hub::captions::{CaptionGroup, merge_captions};
use crate::providers::hub::matching::{
    Kind, base_title, display_title, match_score, normalize_title, season_in_title, year_in_title,
};
use crate::providers::hub::opensubs;
use crate::providers::models::{
    CatalogItem, MediaDetails, ProviderError, ProviderKind, Release, SubtitleOption,
};
use crate::providers::{Provider, ReleaseProvider};

const IMDB_TTL: Duration = Duration::from_secs(60 * 60);
const IMDB_MISSING_TTL: Duration = Duration::from_secs(10 * 60);
const ALT_TTL: Duration = Duration::from_secs(60 * 60);
const ALT_MISSING_TTL: Duration = Duration::from_secs(60);
const ALT_RELEASES_TTL: Duration = Duration::from_secs(5 * 60);
const CAPTIONS_TTL: Duration = Duration::from_secs(30 * 60);
/// Used when a source was slow or failed, so the gap heals soon.
const CAPTIONS_PARTIAL_TTL: Duration = Duration::from_secs(2 * 60);
const SOURCE_TIMEOUT: Duration = Duration::from_secs(8);
const ALT_STREAMS_TIMEOUT: Duration = Duration::from_secs(12);
/// The anime resolver can legitimately take ~20s to warm up, but when it is
/// still going after this, the catalog fallback gets the remaining time.
const ANIME_NATIVE_TIMEOUT: Duration = Duration::from_secs(35);
/// Candidates per provider tried when looking for an alternate source.
const ALT_CANDIDATES: usize = 3;

/// A title's IMDb identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImdbRef {
    pub imdb: String,
    pub is_series: bool,
}

/// Where a title can be played when Collaps does not have it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AltSource {
    pub provider: ProviderKind,
    pub id: String,
}

pub struct HubState {
    imdb: TtlCache<ImdbRef>,
    imdb_missing: TtlCache<()>,
    alt_found: TtlCache<AltSource>,
    alt_missing: TtlCache<()>,
    alt_releases: TtlCache<Arc<Vec<Release>>>,
    captions: TtlCache<Vec<SubtitleOption>>,
    captions_partial: TtlCache<Vec<SubtitleOption>>,
    /// One resolve at a time per anime episode; concurrent callers share its result.
    anime_inflight: std::sync::Mutex<std::collections::HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl Default for HubState {
    fn default() -> Self {
        Self {
            imdb: TtlCache::new(IMDB_TTL),
            imdb_missing: TtlCache::new(IMDB_MISSING_TTL),
            alt_found: TtlCache::new(ALT_TTL),
            alt_missing: TtlCache::new(ALT_MISSING_TTL),
            alt_releases: TtlCache::new(ALT_RELEASES_TTL),
            captions: TtlCache::new(CAPTIONS_TTL),
            captions_partial: TtlCache::new(CAPTIONS_PARTIAL_TTL),
            anime_inflight: Default::default(),
        }
    }
}

fn item_year(item: &CatalogItem) -> Option<i32> {
    item.year
        .as_deref()
        .and_then(|y| y.trim().get(..4))
        .and_then(|y| y.parse().ok())
        .or_else(|| year_in_title(&item.title))
}

fn details_year(details: &MediaDetails) -> Option<i32> {
    details
        .year
        .as_deref()
        .and_then(|y| y.trim().get(..4))
        .and_then(|y| y.parse().ok())
}

/// Candidates ranked best-first: same normalised title, compatible kind and
/// year (±1), untagged before dub-tagged, season-matching before others.
pub(crate) fn rank_candidates(
    title: &str,
    year: Option<i32>,
    kind: Kind,
    wanted_season: Option<usize>,
    items: &[CatalogItem],
) -> Vec<CatalogItem> {
    let mut scored: Vec<(i32, usize, &CatalogItem)> = items
        .iter()
        .enumerate()
        .filter_map(|(i, item)| {
            let mut score = match_score(
                title,
                year,
                kind,
                &item.title,
                item_year(item),
                item.media_type.into(),
            )?;
            if let (Some(want), Some(have)) = (wanted_season, season_in_title(&item.title)) {
                score += if want == have { 15 } else { -15 };
            }
            Some((score, i, item))
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    scored
        .into_iter()
        .map(|(_, _, item)| item.clone())
        .collect()
}

/// Which hit of a Cinemeta search is the wanted title: best [`match_score`],
/// Cinemeta rank breaks ties; anime prefer animated series.
pub(crate) fn pick_hit(
    title: &str,
    year: Option<i32>,
    kind: Kind,
    hits: &[crate::providers::collaps::cinemeta::MetaHit],
) -> Option<ImdbRef> {
    hits.iter()
        .enumerate()
        .filter_map(|(rank, hit)| {
            let hit_kind = if hit.is_series {
                Kind::Series
            } else {
                Kind::Movie
            };
            let mut score = match_score(title, year, kind, &hit.title, hit.year, hit_kind)?;
            if kind == Kind::Anime {
                if hit
                    .genres
                    .iter()
                    .any(|g| g.eq_ignore_ascii_case("animation") || g.eq_ignore_ascii_case("anime"))
                {
                    score += 5;
                }
                if hit.is_series {
                    score += 2;
                }
            }
            Some((score, std::cmp::Reverse(rank), hit))
        })
        .max_by_key(|(score, rank, _)| (*score, *rank))
        .map(|(_, _, hit)| ImdbRef {
            imdb: hit.imdb.clone(),
            is_series: hit.is_series,
        })
}

/// Outcome of one caption source.
struct Source {
    group: CaptionGroup,
    /// False when the source timed out or errored (result may be incomplete).
    complete: bool,
}

async fn timed<F>(provider: &'static str, limit: Duration, fut: F) -> Source
where
    F: std::future::Future<Output = Result<Vec<SubtitleOption>, String>>,
{
    match tokio::time::timeout(limit, fut).await {
        Ok(Ok(items)) => Source {
            group: CaptionGroup { provider, items },
            complete: true,
        },
        Ok(Err(e)) => {
            log::debug!("captions: {provider} failed: {e}");
            Source {
                group: CaptionGroup {
                    provider,
                    items: Vec::new(),
                },
                complete: false,
            }
        }
        Err(_) => {
            log::debug!("captions: {provider} timed out after {limit:?}");
            Source {
                group: CaptionGroup {
                    provider,
                    items: Vec::new(),
                },
                complete: false,
            }
        }
    }
}

impl MovieBoxService {
    /// Releases (playable sources) for any provider. Collaps titles that
    /// Collaps cannot serve fall back to MovieBox / 4KHDHub transparently.
    pub async fn releases_for(
        &self,
        provider: ProviderKind,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        match provider {
            ProviderKind::Collaps => self.collaps_streams(id, season, episode).await,
            ProviderKind::Anime => self.anime_streams(id, season, episode).await,
            other => self.native_releases(other, id, season, episode).await,
        }
    }

    /// Serializes concurrent resolves of the same episode (double-mounted
    /// players, retry clicks): the first does the work, the rest read its cache.
    async fn anime_streams(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        let key = format!("{id}:{season}:{episode}");
        let gate = {
            let mut map = self.hub.anime_inflight.lock().unwrap_or_else(|e| e.into_inner());
            map.entry(key.clone()).or_default().clone()
        };
        let result = {
            let _turn = gate.lock().await;
            self.anime_streams_once(id, season, episode).await
        };
        let mut map = self.hub.anime_inflight.lock().unwrap_or_else(|e| e.into_inner());
        if Arc::strong_count(&gate) == 2 {
            map.remove(&key);
        }
        drop(map);
        result
    }

    /// Anime scrapers first; when they are down, blocked or slow, the same
    /// show is played from the IMDb catalog (Collaps, then its alternates).
    async fn anime_streams_once(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        let down_key = format!("anime-native:{id}");
        let cache_key = format!("anime:{id}:{season}:{episode}");
        if let Some(releases) = self.hub.alt_releases.get(&cache_key) {
            return Ok(releases.as_ref().clone());
        }

        // A scraper that just failed is not retried for a minute, so repeat
        // plays (retry button, strict-mode double load) skip straight to the
        // fallback instead of waiting out the scrapers again.
        let native = if self.hub.alt_missing.get(&down_key).is_some() {
            Err(ProviderError::Unavailable(
                "This title isn't available right now. Try again or pick another source."
                    .to_string(),
            ))
        } else {
            match tokio::time::timeout(
                ANIME_NATIVE_TIMEOUT,
                self.native_releases(ProviderKind::Anime, id, season, episode),
            )
            .await
            {
                Ok(Ok(releases)) if releases.iter().any(|r| !r.mirrors.is_empty()) => {
                    return Ok(releases);
                }
                Ok(result) => result,
                Err(_) => Err(ProviderError::Unavailable(
                    "This title isn't available right now. Try again or pick another source."
                        .to_string(),
                )),
            }
        };
        self.hub.alt_missing.insert(down_key, ());

        let fallback = async {
            let (title, year, kind) = self.identity_of(ProviderKind::Anime, id).await?;
            let imdb = self.imdb_for(&title, year, kind).await?;
            // Anime entries are single cours: episode N of the first season.
            // An IMDb *movie* (anime film) is played as-is.
            let (s, e) = if imdb.is_series {
                (season.max(1), episode.max(1))
            } else {
                (0, 0)
            };
            match self.collaps_streams(&imdb.imdb, s, e).await {
                Ok(releases) if releases.iter().any(|r| !r.mirrors.is_empty()) => {
                    log::info!("anime {id} ep{episode}: playing from catalog {}", imdb.imdb);
                    Some(releases)
                }
                _ => None,
            }
        };
        match fallback.await {
            Some(releases) => {
                self.hub
                    .alt_releases
                    .insert(cache_key, Arc::new(releases.clone()));
                Ok(releases)
            }
            None => native,
        }
    }

    async fn native_releases(
        &self,
        provider: ProviderKind,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        match provider {
            ProviderKind::MovieBox => {
                ReleaseProvider::episode_streams(&self.client, id, season, episode).await
            }
            ProviderKind::FourKHdHub => match self.fourk_client.as_ref() {
                Some(client) => ReleaseProvider::episode_streams(client, id, season, episode).await,
                None => Err(ProviderError::Unavailable(
                    "4KHDHub is unavailable".to_string(),
                )),
            },
            ProviderKind::BdixCircleFtp => {
                ReleaseProvider::episode_streams(&self.circleftp_client, id, season, episode).await
            }
            ProviderKind::BdixDhakaFlix => {
                ReleaseProvider::episode_streams(&self.dhakaflix_client, id, season, episode).await
            }
            ProviderKind::Addons => Err(ProviderError::Unavailable(
                "addon stream resolution is not part of this API yet".to_string(),
            )),
            ProviderKind::Anime => {
                ReleaseProvider::episode_streams(&self.anime_client, id, season, episode).await
            }
            ProviderKind::Collaps => {
                ReleaseProvider::episode_streams(&self.collaps_client, id, season, episode).await
            }
        }
    }

    /// Collaps first; any failure to serve the title (not on Collaps, Collaps
    /// down) falls back to another source that has it.
    pub async fn collaps_streams(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        let primary =
            ReleaseProvider::episode_streams(&self.collaps_client, id, season, episode).await;
        match primary {
            Ok(releases) if !releases.is_empty() => return Ok(releases),
            _ => {}
        }
        match self.alt_releases_for(id, season, episode).await {
            Some((_, releases)) => Ok(releases.as_ref().clone()),
            None => primary.and_then(|r| {
                if r.is_empty() {
                    Err(ProviderError::NotFound)
                } else {
                    Ok(r)
                }
            }),
        }
    }

    /// `(season, episode)` to use for a title: as requested, or 1/1 when a
    /// series was asked for without one.
    async fn episode_for(&self, imdb: &str, season: usize, episode: usize) -> (usize, usize) {
        if season > 0 && episode > 0 {
            return (season, episode);
        }
        match Provider::details(&self.collaps_client, imdb).await {
            Ok(d) if d.is_series() => (season.max(1), episode.max(1)),
            _ => (season, episode),
        }
    }

    /// The alternate source for a Collaps (IMDb) title, with its releases for
    /// the requested episode. Cached: found 1h, missing 60s.
    async fn alt_releases_for(
        &self,
        imdb: &str,
        season: usize,
        episode: usize,
    ) -> Option<(AltSource, Arc<Vec<Release>>)> {
        let (season, episode) = self.episode_for(imdb, season, episode).await;
        let key = format!("{imdb}:{season}:{episode}");
        let map_key = format!("{imdb}:{season}");
        if let Some(releases) = self.hub.alt_releases.get(&key) {
            if let Some(source) = self.hub.alt_found.get(&map_key) {
                return Some((source, releases));
            }
        }
        if self.hub.alt_missing.get(&map_key).is_some() {
            return None;
        }

        let details = Provider::details(&self.collaps_client, imdb).await.ok()?;
        let kind: Kind = details.media_type.into();
        let year = details_year(&details);
        let query = display_title(&details.title);

        let mut providers = vec![ProviderKind::MovieBox];
        if self.fourk_client.is_some() {
            providers.push(ProviderKind::FourKHdHub);
        }
        // A previously found source is tried first.
        if let Some(known) = self.hub.alt_found.get(&map_key) {
            providers.retain(|p| *p != known.provider);
            providers.insert(0, known.provider);
        }

        let wanted_season = (season > 0).then_some(season);
        for provider in providers {
            let found =
                match tokio::time::timeout(SOURCE_TIMEOUT, self.search_typed(provider, &query, 1))
                    .await
                {
                    Ok(Ok(items)) => items,
                    _ => continue,
                };
            let candidates = rank_candidates(&details.title, year, kind, wanted_season, &found);
            for candidate in candidates.into_iter().take(ALT_CANDIDATES) {
                let id = candidate.id.value.clone();
                let streams = tokio::time::timeout(
                    ALT_STREAMS_TIMEOUT,
                    self.native_releases(provider, &id, season, episode),
                )
                .await;
                if let Ok(Ok(releases)) = streams {
                    if releases.iter().any(|r| !r.mirrors.is_empty()) {
                        log::info!("alt source for {imdb} s{season}e{episode}: {provider} {id}");
                        let source = AltSource { provider, id };
                        let releases = Arc::new(releases);
                        self.hub.alt_found.insert(map_key, source.clone());
                        self.hub.alt_releases.insert(key, releases.clone());
                        return Some((source, releases));
                    }
                }
            }
        }
        self.hub.alt_missing.insert(map_key, ());
        None
    }

    /// Map a title from any provider to its IMDb entry through Cinemeta search.
    pub async fn imdb_for(&self, title: &str, year: Option<i32>, kind: Kind) -> Option<ImdbRef> {
        let query = if kind == Kind::Anime {
            base_title(title)
        } else {
            display_title(title)
        };
        // Anime seasons rarely line up with IMDb's year; match on title alone.
        let year = if kind == Kind::Anime { None } else { year };
        let key = format!("{}|{:?}|{:?}", normalize_title(&query), year, kind);
        if let Some(hit) = self.hub.imdb.get(&key) {
            return Some(hit);
        }
        if self.hub.imdb_missing.get(&key).is_some() {
            return None;
        }
        let hits = match self.collaps_client.search_hits(&query).await {
            Ok(hits) => hits,
            Err(e) => {
                log::debug!("imdb_for({query}): cinemeta search failed: {e}");
                return None; // transient: not cached as missing
            }
        };
        match pick_hit(&query, year, kind, &hits) {
            Some(found) => {
                self.hub.imdb.insert(key, found.clone());
                Some(found)
            }
            None => {
                self.hub.imdb_missing.insert(key, ());
                None
            }
        }
    }

    /// Native (non-OpenSubtitles) captions of `provider`'s title.
    async fn native_captions(
        &self,
        provider: ProviderKind,
        id: &str,
        season: usize,
        episode: usize,
        resource_id: Option<&str>,
    ) -> Result<Vec<SubtitleOption>, String> {
        match provider {
            ProviderKind::Collaps => Ok(self.collaps_client.captions(id, season, episode).await),
            ProviderKind::Anime => Ok(self.anime_client.episode_captions(id, episode.max(1)).await),
            ProviderKind::MovieBox => {
                let rid = match resource_id.filter(|r| !r.is_empty()) {
                    Some(rid) => rid.to_string(),
                    None => ReleaseProvider::episode_streams(&self.client, id, season, episode)
                        .await
                        .map_err(|e| e.to_string())?
                        .into_iter()
                        .find_map(|r| r.resource_id)
                        .unwrap_or_default(),
                };
                let siblings: Vec<String> =
                    match self.details_typed(ProviderKind::MovieBox, id).await {
                        Ok(details) => details
                            .dubs
                            .iter()
                            .filter(|d| d.subject_id != id)
                            .map(|d| d.subject_id.clone())
                            .take(3)
                            .collect(),
                        Err(_) => Vec::new(),
                    };
                self.get_ext_captions(id, &rid, &siblings).await
            }
            // 4KHDHub ships none of its own; BDIX/addons are not subtitle-aware.
            _ => Ok(Vec::new()),
        }
    }

    /// OpenSubtitles tracks for a title identified by `imdb` (movie when
    /// `episode` is `None`).
    async fn opensubtitles_for(
        &self,
        imdb: &ImdbRef,
        season: usize,
        episode: usize,
    ) -> Result<Vec<SubtitleOption>, String> {
        let target = imdb.is_series.then_some((season.max(1), episode.max(1)));
        opensubs::fetch(&self.http_client, &imdb.imdb, target).await
    }

    /// Title identity of a non-Collaps item: `(title, year, kind)`.
    async fn identity_of(
        &self,
        provider: ProviderKind,
        id: &str,
    ) -> Option<(String, Option<i32>, Kind)> {
        let details =
            match tokio::time::timeout(SOURCE_TIMEOUT, self.details_typed(provider, id)).await {
                Ok(Ok(d)) => d,
                _ => return None,
            };
        Some((
            details.title.clone(),
            details_year(&details),
            details.media_type.into(),
        ))
    }

    /// Captions from every source for one title, merged and deduplicated.
    /// Never fails: a source that errors or times out just contributes nothing.
    pub async fn captions_for(
        &self,
        provider: ProviderKind,
        id: &str,
        season: usize,
        episode: usize,
        resource_id: Option<&str>,
    ) -> Vec<SubtitleOption> {
        let key = format!(
            "{}:{id}:{season}:{episode}:{}",
            provider.cache_key(),
            resource_id.unwrap_or_default()
        );
        if let Some(hit) = self
            .hub
            .captions
            .get(&key)
            .or_else(|| self.hub.captions_partial.get(&key))
        {
            return hit;
        }

        let (sources, complete) = match provider {
            ProviderKind::Collaps => self.collaps_sources(id, season, episode).await,
            ProviderKind::Anime => {
                let title_fut = self.identity_of(ProviderKind::Anime, id);
                // Soft subs ride on the streams resolve that already ran; a cold
                // resolve here would duplicate it (and can take a minute), so use
                // what is cached and let the short partial-cache TTL pick the
                // tracks up once the episode has been resolved.
                let native = async {
                    match self
                        .anime_client
                        .cached_episode_captions(id, episode.max(1))
                    {
                        Some(items) => Source {
                            group: CaptionGroup {
                                provider: "anime",
                                items,
                            },
                            complete: true,
                        },
                        None => Source {
                            group: CaptionGroup {
                                provider: "anime",
                                items: Vec::new(),
                            },
                            complete: false,
                        },
                    }
                };
                let os = async {
                    let Some((title, _year, _)) = title_fut.await else {
                        return Source {
                            group: CaptionGroup {
                                provider: "opensubtitles",
                                items: Vec::new(),
                            },
                            complete: false,
                        };
                    };
                    // IMDb has one entry per show; AniList splits seasons.
                    let imdb_season = season_in_title(&title).unwrap_or(1);
                    match self.imdb_for(&title, None, Kind::Anime).await {
                        Some(imdb) => {
                            timed(
                                "opensubtitles",
                                SOURCE_TIMEOUT,
                                self.opensubtitles_for(&imdb, imdb_season, episode),
                            )
                            .await
                        }
                        None => Source {
                            group: CaptionGroup {
                                provider: "opensubtitles",
                                items: Vec::new(),
                            },
                            complete: true,
                        },
                    }
                };
                let (native, os) = futures::join!(native, os);
                let complete = native.complete && os.complete;
                (vec![native.group, os.group], complete)
            }
            other => {
                let native = timed(
                    provider_label(other),
                    SOURCE_TIMEOUT,
                    self.native_captions(other, id, season, episode, resource_id),
                );
                let os = async {
                    let Some((title, year, kind)) = self.identity_of(other, id).await else {
                        return Source {
                            group: CaptionGroup {
                                provider: "opensubtitles",
                                items: Vec::new(),
                            },
                            complete: false,
                        };
                    };
                    match self.imdb_for(&title, year, kind).await {
                        Some(imdb) => {
                            timed(
                                "opensubtitles",
                                SOURCE_TIMEOUT,
                                self.opensubtitles_for(&imdb, season, episode),
                            )
                            .await
                        }
                        None => Source {
                            group: CaptionGroup {
                                provider: "opensubtitles",
                                items: Vec::new(),
                            },
                            complete: true,
                        },
                    }
                };
                let (native, os) = futures::join!(native, os);
                let complete = native.complete && os.complete;
                (vec![native.group, os.group], complete)
            }
        };

        let merged = merge_captions(sources);
        if !merged.is_empty() {
            let cache = if complete {
                &self.hub.captions
            } else {
                &self.hub.captions_partial
            };
            cache.insert(key, merged.clone());
        }
        merged
    }

    /// Collaps title: embed subtitles, OpenSubtitles by the title's own IMDb
    /// id, and the native captions of whichever source plays it instead.
    async fn collaps_sources(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> (Vec<CaptionGroup>, bool) {
        let (season, episode) = self.episode_for(id, season, episode).await;
        let is_series = season > 0 && episode > 0;
        let imdb = ImdbRef {
            imdb: id.to_string(),
            is_series,
        };

        let native = timed(
            "collaps",
            SOURCE_TIMEOUT,
            self.native_captions(ProviderKind::Collaps, id, season, episode, None),
        );
        let os = timed(
            "opensubtitles",
            SOURCE_TIMEOUT,
            self.opensubtitles_for(&imdb, season, episode),
        );
        let (native, os) = futures::join!(native, os);
        let mut complete = native.complete && os.complete;
        let mut groups = vec![native.group];

        // Another source plays this title: include its own subtitles. When
        // Collaps had none and no source is known yet, look for one.
        let map_key = format!("{id}:{season}");
        let mut alt = self.hub.alt_found.get(&map_key);
        if alt.is_none() && groups[0].items.is_empty() {
            alt = self
                .alt_releases_for(id, season, episode)
                .await
                .map(|(source, _)| source);
        }
        if let Some(alt) = alt {
            let rid = self
                .hub
                .alt_releases
                .get(&format!("{id}:{season}:{episode}"))
                .and_then(|r| r.iter().find_map(|r| r.resource_id.clone()));
            let label = provider_label(alt.provider);
            let src = timed(
                label,
                SOURCE_TIMEOUT,
                self.native_captions(alt.provider, &alt.id, season, episode, rid.as_deref()),
            )
            .await;
            complete &= src.complete;
            groups.push(src.group);
        }
        groups.push(os.group);
        (groups, complete)
    }
}

fn provider_label(provider: ProviderKind) -> &'static str {
    match provider {
        ProviderKind::MovieBox => "moviebox",
        ProviderKind::FourKHdHub => "fourkhdhub",
        ProviderKind::Anime => "anime",
        ProviderKind::Collaps => "collaps",
        ProviderKind::BdixCircleFtp => "bdix_circleftp",
        ProviderKind::BdixDhakaFlix => "bdix_dhakaflix",
        ProviderKind::Addons => "addons",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::collaps::cinemeta::MetaHit;
    use crate::providers::models::{MediaType, ProviderMediaId};

    fn item(id: &str, title: &str, media: MediaType, year: Option<&str>) -> CatalogItem {
        CatalogItem {
            id: ProviderMediaId {
                provider: ProviderKind::MovieBox,
                value: id.into(),
            },
            title: title.into(),
            media_type: media,
            year: year.map(str::to_string),
            poster_url: None,
            season_count: None,
        }
    }

    fn hit(imdb: &str, title: &str, year: Option<i32>, series: bool, genres: &[&str]) -> MetaHit {
        MetaHit {
            imdb: imdb.into(),
            title: title.into(),
            year,
            is_series: series,
            genres: genres.iter().map(|g| g.to_string()).collect(),
        }
    }

    fn ids(items: &[CatalogItem]) -> Vec<&str> {
        items.iter().map(|i| i.id.value.as_str()).collect()
    }

    #[test]
    fn candidates_prefer_untagged_exact_year_and_reject_the_rest() {
        let items = vec![
            item("hindi", "Inception [Hindi]", MediaType::Movie, Some("2010")),
            item(
                "cobol",
                "Inception: The Cobol Job",
                MediaType::Movie,
                Some("2010"),
            ),
            item("remake", "Inception", MediaType::Movie, Some("2016")),
            item("plain", "Inception", MediaType::Movie, Some("2010")),
            item("series", "Inception", MediaType::Series, Some("2010")),
        ];
        let ranked = rank_candidates("Inception", Some(2010), Kind::Movie, None, &items);
        assert_eq!(ids(&ranked), ["plain", "hindi"]);
    }

    #[test]
    fn series_candidates_prefer_the_requested_season() {
        let items = vec![
            item(
                "s4",
                "Breaking Bad [Hindi] S4",
                MediaType::Series,
                Some("2011"),
            ),
            item(
                "s5",
                "Breaking Bad [Hindi] S5",
                MediaType::Series,
                Some("2012"),
            ),
        ];
        let ranked = rank_candidates("Breaking Bad", Some(2008), Kind::Series, Some(5), &items);
        assert!(ranked.is_empty(), "years more than one apart are rejected");
        let ranked = rank_candidates("Breaking Bad", None, Kind::Series, Some(5), &items);
        assert_eq!(ids(&ranked), ["s5", "s4"]);
    }

    #[test]
    fn imdb_pick_scores_title_year_and_kind() {
        let hits = vec![
            hit("tt1", "Inception: The Cobol Job", Some(2010), false, &[]),
            hit("tt2", "Inception", Some(2014), false, &[]),
            hit("tt1375666", "Inception", Some(2010), false, &["Sci-Fi"]),
        ];
        let found = pick_hit("Inception", Some(2010), Kind::Movie, &hits).unwrap();
        assert_eq!(
            found,
            ImdbRef {
                imdb: "tt1375666".into(),
                is_series: false
            }
        );
        assert!(pick_hit("Interstellar", Some(2014), Kind::Movie, &hits).is_none());
    }

    #[test]
    fn imdb_pick_for_anime_prefers_animated_series_and_ignores_year() {
        let hits = vec![
            hit("tt-live", "Death Note", Some(2017), false, &["Crime"]),
            hit(
                "tt-anime",
                "Death Note",
                Some(2006),
                true,
                &["Animation", "Mystery"],
            ),
        ];
        let found = pick_hit("Death Note", None, Kind::Anime, &hits).unwrap();
        assert_eq!(found.imdb, "tt-anime");
        assert!(found.is_series);
    }

    #[test]
    fn imdb_pick_ties_go_to_cinemeta_rank() {
        let hits = vec![
            hit("tt-first", "Dune", Some(2021), false, &[]),
            hit("tt-second", "Dune", Some(2021), false, &[]),
        ];
        assert_eq!(
            pick_hit("Dune", Some(2021), Kind::Movie, &hits)
                .unwrap()
                .imdb,
            "tt-first"
        );
    }

    #[test]
    fn hub_state_constructs_with_empty_caches() {
        let hub = HubState::default();
        assert!(hub.captions.get("x").is_none());
    }
}
