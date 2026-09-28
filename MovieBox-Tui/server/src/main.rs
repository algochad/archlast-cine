//! Headless HTTP backend over the `moviebox_tui` crate.
//!
//! Serves search/details/streams from the upstream provider engine, plus a
//! ticket-based media proxy that attaches the provider-required auth headers
//! (signed CloudFront cookies, UA, referer) to byte/range requests that a
//! browser cannot make itself.
//!
//! Bind address: `MOVIEBOX_SERVER_HOST` (default 127.0.0.1),
//! `MOVIEBOX_SERVER_PORT` (default 9797).
//! External base used when rewriting media URLs inside DASH manifests
//! (required when the server sits behind a reverse proxy):
//! `MOVIEBOX_PROXY_BASE`; defaults to the request's Host /
//! X-Forwarded-Proto headers.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use tokio::io::AsyncBufReadExt;

use moviebox_tui::providers::{CatalogItem, ProviderError, ProviderKind, Release, ReleaseProvider};
use moviebox_tui::service::MovieBoxService;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

fn origin_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .map(|u| match u.port() {
            Some(p) => format!("{}://{}:{p}", u.scheme(), u.host_str().unwrap_or_default()),
            None => format!("{}://{}", u.scheme(), u.host_str().unwrap_or_default()),
        })
        .unwrap_or_default()
}

fn random_hex(len: usize) -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    (0..len)
        .map(|_| format!("{:x}", rng.random_range(0..16)))
        .collect()
}

struct Ticket {
    raw_url: String,
    origin: String,
    headers: Vec<(String, String)>,
    created: Instant,
}

#[derive(Default)]
struct TicketStore {
    inner: Mutex<HashMap<String, Ticket>>,
}

impl TicketStore {
    const TTL: Duration = Duration::from_secs(30 * 60);
    const MAX: usize = 8192;

    fn insert(&self, raw_url: String, headers: Vec<(String, String)>) -> (String, String) {
        let origin = origin_of(&raw_url);
        let mut map = self.inner.lock();
        if map.len() >= Self::MAX {
            map.retain(|_, t| t.created.elapsed() < Self::TTL);
        }
        if map.len() >= Self::MAX {
            let oldest = map
                .iter()
                .min_by_key(|(_, t)| t.created)
                .map(|(k, _)| k.clone());
            if let Some(k) = oldest {
                map.remove(&k);
            }
        }
        let ticket = loop {
            let candidate = random_hex(16);
            if !map.contains_key(&candidate) {
                break candidate;
            }
        };
        map.insert(
            ticket.clone(),
            Ticket {
                raw_url,
                origin: origin.clone(),
                headers,
                created: Instant::now(),
            },
        );
        (ticket, origin)
    }

    /// Insert-and-reuse: return the existing ticket when the same
    /// (raw_url, headers) pair is already stored and fresh, so HLS rewrites
    /// that touch hundreds of segment URLs don't evict live tickets.
    fn insert_dedup(&self, raw_url: String, headers: Vec<(String, String)>) -> (String, String) {
        let origin = origin_of(&raw_url);
        let mut map = self.inner.lock();
        if let Some((ticket, _)) = map.iter().find(|(_, t)| {
            t.raw_url == raw_url && t.headers == headers && t.created.elapsed() < Self::TTL
        }) {
            return (ticket.clone(), origin);
        }
        if map.len() >= Self::MAX {
            map.retain(|_, t| t.created.elapsed() < Self::TTL);
        }
        if map.len() >= Self::MAX {
            let oldest = map
                .iter()
                .min_by_key(|(_, t)| t.created)
                .map(|(k, _)| k.clone());
            if let Some(k) = oldest {
                map.remove(&k);
            }
        }
        let ticket = loop {
            let candidate = random_hex(16);
            if !map.contains_key(&candidate) {
                break candidate;
            }
        };
        map.insert(
            ticket.clone(),
            Ticket {
                raw_url,
                origin: origin.clone(),
                headers,
                created: Instant::now(),
            },
        );
        (ticket, origin)
    }

    fn get(&self, id: &str) -> Option<Ticket> {
        let map = self.inner.lock();
        let t = map.get(id)?;
        if t.created.elapsed() > Self::TTL {
            return None;
        }
        Some(Ticket {
            raw_url: t.raw_url.clone(),
            origin: t.origin.clone(),
            headers: t.headers.clone(),
            created: t.created,
        })
    }
}

// ---------------------------------------------------------------------------
// Transcode sessions: on-demand ffmpeg HLS (H.264) gateway so HEVC-only
// DASH streams play in browsers that lack HEVC MSE support. ffmpeg reads the
// source through our own header-injecting media proxy.
// ---------------------------------------------------------------------------

struct TranscodeSession {
    ticket: String,
    /// Source manifest URL fed to ffmpeg (through the header-injecting proxy
    /// whenever possible). Reused verbatim when a seek restarts the pipeline.
    manifest_url: String,
    dir: PathBuf,
    child: Option<tokio::process::Child>,
    last_used: Instant,
    started: Instant,
    /// Total source length in seconds parsed from the manifest's
    /// mediaPresentationDuration; None when it could not be determined.
    duration_seconds: Option<f64>,
    /// Seconds of media produced so far (sum of playlist EXTINF durations),
    /// expressed in content-absolute terms (pipeline base offset + playlist
    /// sum). Kept monotonic while a pipeline runs; a seek restart re-anchors
    /// it to the seek position.
    produced_seconds: f64,
    /// Content-absolute offset (seconds into the source) at which the current
    /// ffmpeg pipeline's output begins. 0.0 for a fresh start; the seek
    /// position after a restart. `produced_seconds = produced_base + EXTINF sum`.
    produced_base: f64,
    /// True while a seek restart is tearing down / respawning ffmpeg.
    /// Doubles as the concurrency guard: checked and set under the registry
    /// lock, so a second concurrent seek on this session fails with 409.
    restarting: bool,
}

/// Session registry. Guard with the map mutex only for short, non-await
/// sections: ffmpeg child handling and reaping never holds the lock across
/// waits that could stall a request handler.
#[derive(Default)]
struct TranscodeStore {
    inner: Mutex<HashMap<String, TranscodeSession>>,
}

impl TranscodeStore {
    const TTL: Duration = Duration::from_secs(20 * 60);

    fn prune_locked(map: &mut HashMap<String, TranscodeSession>) -> Vec<TranscodeSession> {
        let cutoff = Instant::now() - Self::TTL;
        let mut stale: Vec<String> = Vec::new();
        for (id, s) in map.iter() {
            if s.last_used < cutoff {
                stale.push(id.clone());
            }
        }
        let mut dropped = Vec::new();
        for id in stale {
            if let Some(s) = map.remove(&id) {
                dropped.push(s);
            }
        }
        dropped
    }
}

/// Env-tunable knobs for the transcode gateway (read once at startup).
struct TranscodeConfig {
    enabled: bool,
    base_dir: PathBuf,
    ffmpeg_path: String,
    preset: String,
    crf: String,
    proxy_port: String,
}

impl TranscodeConfig {
    fn from_env() -> Self {
        let enabled = std::env::var("TRANSCODE_ENABLED").unwrap_or_else(|_| "1".to_string());
        let base_dir = std::env::var("MOVIEBOX_TRANSCODE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("moviebox-transcode"));
        TranscodeConfig {
            enabled: enabled == "1",
            base_dir,
            ffmpeg_path: std::env::var("MOVIEBOX_FFMPEG_PATH")
                .unwrap_or_else(|_| "ffmpeg".to_string()),
            preset: std::env::var("MOVIEBOX_TRANSCODE_PRESET")
                .unwrap_or_else(|_| "veryfast".to_string()),
            crf: std::env::var("MOVIEBOX_TRANSCODE_CRF").unwrap_or_else(|_| "24".to_string()),
            proxy_port: std::env::var("MOVIEBOX_SERVER_PORT").unwrap_or_else(|_| "9797".to_string()),
        }
    }
}

#[derive(Clone)]
struct AppState {
    svc: Arc<MovieBoxService>,
    tickets: Arc<TicketStore>,
    /// reqwest client without a total-request timeout (long media streams).
    proxy_client: reqwest::Client,
    proxy_base: String,
    transcodes: Arc<TranscodeStore>,
    transcode_cfg: Arc<TranscodeConfig>,
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn api_error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(serde_json::json!({ "error": message.into() }))).into_response()
}

fn provider_of(raw: &str) -> Result<ProviderKind, Response> {
    ProviderKind::parse(raw).ok_or_else(|| {
        api_error(
            StatusCode::BAD_REQUEST,
            format!("unknown provider: {raw} (expected moviebox, fourkhdhub, bdix_circleftp, bdix_dhakaflix, addons or anime)"),
        )
    })
}

/// User-visible anime failures use the generic unavailable copy; every other
/// provider keeps its existing message. Technical detail stays in logs.
fn provider_err_response(err: ProviderError) -> Response {
    provider_err_response_for(ProviderKind::MovieBox, err)
}

fn provider_err_response_for(provider: ProviderKind, err: ProviderError) -> Response {
    let status = match err {
        ProviderError::NotFound => StatusCode::NOT_FOUND,
        ProviderError::RateLimited(_) => StatusCode::TOO_MANY_REQUESTS,
        _ => StatusCode::BAD_GATEWAY,
    };
    if provider == ProviderKind::Anime {
        log::warn!("anime request failed ({status}): {err}");
        return api_error(status, anime_user_message(status));
    }
    api_error(status, err.to_string())
}

/// Generic user-visible copy for anime failures. Status semantics stay intact
/// (404 vs 502/429) so the UI can still distinguish not-found vs unavailable.
fn anime_user_message(status: StatusCode) -> &'static str {
    if status == StatusCode::NOT_FOUND {
        "This title wasn't found. Try another title or source."
    } else {
        "This title isn't available right now. Try again or pick another source."
    }
}

/// Anime call sites render the generic copy; every other provider keeps its
/// existing message. Technical detail stays in server logs.
fn anime_or(provider: ProviderKind, status: StatusCode, legacy: &str) -> String {
    if provider == ProviderKind::Anime {
        anime_user_message(status).to_string()
    } else {
        legacy.to_string()
    }
}

// ---------------------------------------------------------------------------
// Metadata handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SearchParams {
    q: String,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    page: Option<usize>,
}

async fn search(State(state): State<AppState>, Query(p): Query<SearchParams>) -> Response {
    let q = p.q.trim();
    if q.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "missing query");
    }
    let provider = match p.provider.as_deref() {
        Some(raw) => match provider_of(raw) {
            Ok(k) => k,
            Err(e) => return e,
        },
        None => ProviderKind::MovieBox,
    };
    let page = p.page.unwrap_or(1);
    match state.svc.search_typed(provider, q, page).await {
        Ok(items) => Json(serde_json::json!({
            "provider": provider,
            "query": q,
            "page": page,
            "items": items,
        }))
        .into_response(),
        Err(e) => provider_err_response_for(provider, e),
    }
}

#[derive(Deserialize)]
struct DetailsParams {
    provider: String,
    id: String,
}

async fn details(State(state): State<AppState>, Query(p): Query<DetailsParams>) -> Response {
    let provider = match provider_of(&p.provider) {
        Ok(k) => k,
        Err(e) => return e,
    };
    match state.svc.details_typed(provider, &p.id).await {
        Ok(details) => Json(serde_json::json!({
            "provider": provider,
            "id": p.id,
            "details": details,
        }))
        .into_response(),
        Err(e) => provider_err_response_for(provider, e),
    }
}

#[derive(Deserialize)]
struct StreamsParams {
    provider: String,
    id: String,
    #[serde(default)]
    season: Option<usize>,
    #[serde(default)]
    episode: Option<usize>,
}

async fn streams(State(state): State<AppState>, Query(p): Query<StreamsParams>) -> Response {
    let provider = match provider_of(&p.provider) {
        Ok(k) => k,
        Err(e) => return e,
    };
    let season = p.season.unwrap_or(0);
    let episode = p.episode.unwrap_or(0);
    match fetch_releases(&state.svc, provider, &p.id, season, episode).await {
        Ok(releases) => Json(serde_json::json!({
            "provider": provider,
            "id": p.id,
            "season": season,
            "episode": episode,
            "releases": releases,
        }))
        .into_response(),
        Err(e) => provider_err_response_for(provider, e),
    }
}

#[derive(Deserialize)]
struct HomeParams {
    #[serde(default)]
    tab: Option<String>,
    #[serde(default)]
    page: Option<usize>,
}

async fn home(State(state): State<AppState>, Query(p): Query<HomeParams>) -> Response {
    let tab = p.tab.unwrap_or_else(|| "2".to_string());
    let page = p.page.unwrap_or(1);
    match state.svc.homepage(&tab, page).await {
        Ok((items, metrics)) => Json(serde_json::json!({
            "tab": tab,
            "page": page,
            "items": items,
            "metrics": metrics,
        }))
        .into_response(),
        Err(e) => api_error(StatusCode::BAD_GATEWAY, e),
    }
}

#[derive(Deserialize)]
struct SuggestParams {
    q: String,
}

async fn suggest(State(state): State<AppState>, Query(p): Query<SuggestParams>) -> Response {
    match state.svc.suggest(&p.q).await {
        Ok(suggestions) => Json(serde_json::json!({ "query": p.q, "suggestions": suggestions }))
            .into_response(),
        Err(e) => api_error(StatusCode::BAD_GATEWAY, e),
    }
}

// ---------------------------------------------------------------------------
// Unified cross-provider search + seasonal anime
// ---------------------------------------------------------------------------

/// Max items one provider contributes to a unified search.
const UNIFIED_PER_PROVIDER: usize = 20;
/// Max items in a unified search response.
const UNIFIED_TOTAL: usize = 50;

#[derive(Deserialize)]
struct UnifiedSearchParams {
    q: String,
}

/// Simple relevance score for merged results: exact title match ranks highest,
/// then prefix, then substring. The per-provider order (already sorted by the
/// upstream engines) breaks ties via stable sort.
fn relevance_score(query: &str, item: &CatalogItem) -> i32 {
    let title = item.title.to_lowercase();
    let q = query.to_lowercase();
    if title == q {
        3
    } else if title.starts_with(&q) {
        2
    } else if title.contains(&q) {
        1
    } else {
        0
    }
}

/// Search every enabled metadata provider in parallel and merge the results
/// into one relevance-ranked list. A provider that errors (unavailable,
/// rate-limited) degrades to zero items recorded under `errors`; the response
/// itself never fails because one source is down.
async fn search_unified(
    State(state): State<AppState>,
    Query(p): Query<UnifiedSearchParams>,
) -> Response {
    let q = p.q.trim().to_string();
    if q.is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "missing query");
    }

    let providers = [
        ProviderKind::MovieBox,
        ProviderKind::FourKHdHub,
        ProviderKind::Anime,
    ];
    let mut set = tokio::task::JoinSet::new();
    for provider in providers {
        let svc = state.svc.clone();
        let query = q.clone();
        set.spawn(async move {
            match svc.search_typed(provider, &query, 1).await {
                Ok(items) => Ok((provider, items)),
                Err(e) => Err((provider, e)),
            }
        });
    }

    let mut merged: Vec<(ProviderKind, CatalogItem)> = Vec::new();
    let mut errors: Vec<serde_json::Value> = Vec::new();
    while let Some(joined) = set.join_next().await {
        match joined {
            Ok(Ok((provider, items))) => {
                for item in items.into_iter().take(UNIFIED_PER_PROVIDER) {
                    merged.push((provider, item));
                }
            }
            Ok(Err((provider, e))) => {
                log::warn!("unified search: provider={provider} failed: {e}");
                let message = if provider == ProviderKind::Anime {
                    anime_user_message(StatusCode::BAD_GATEWAY).to_string()
                } else {
                    e.to_string()
                };
                errors.push(serde_json::json!({ "provider": provider, "error": message }));
            }
            Err(e) => errors.push(serde_json::json!({ "error": e.to_string() })),
        }
    }

    merged.sort_by(|a, b| {
        relevance_score(&q, &b.1).cmp(&relevance_score(&q, &a.1))
    });
    merged.truncate(UNIFIED_TOTAL);

    let items: Vec<serde_json::Value> = merged
        .into_iter()
        .map(|(provider, item)| {
            let mut value = serde_json::to_value(item).unwrap_or(serde_json::Value::Null);
            if let serde_json::Value::Object(map) = &mut value {
                map.insert("provider".to_string(), serde_json::json!(provider));
            }
            value
        })
        .collect();

    Json(serde_json::json!({
        "query": q,
        "items": items,
        "errors": errors,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct SeasonalParams {
    season: String,
    year: i64,
    #[serde(default)]
    page: Option<usize>,
}

async fn anime_seasonal(
    State(state): State<AppState>,
    Query(p): Query<SeasonalParams>,
) -> Response {
    let page = p.page.unwrap_or(1);
    match state.svc.anime_client.seasonal(&p.season, p.year, page).await {
        Ok(items) => Json(serde_json::json!({
            "season": p.season.to_lowercase(),
            "year": p.year,
            "page": page,
            "items": items,
        }))
        .into_response(),
        Err(e) => provider_err_response_for(ProviderKind::Anime, e),
    }
}

#[derive(Deserialize)]
struct AnimeBrowseParams {
    #[serde(default)]
    page: Option<usize>,
}

async fn anime_trending(
    State(state): State<AppState>,
    Query(p): Query<AnimeBrowseParams>,
) -> Response {
    let page = p.page.unwrap_or(1);
    match state.svc.anime_client.browse("TRENDING_DESC", None, page).await {
        Ok(items) => Json(serde_json::json!({
            "sort": "trending",
            "page": page,
            "items": items,
        }))
        .into_response(),
        Err(e) => provider_err_response_for(ProviderKind::Anime, e),
    }
}

async fn anime_popular(
    State(state): State<AppState>,
    Query(p): Query<AnimeBrowseParams>,
) -> Response {
    let page = p.page.unwrap_or(1);
    match state.svc.anime_client.browse("POPULARITY_DESC", None, page).await {
        Ok(items) => Json(serde_json::json!({
            "sort": "popular",
            "page": page,
            "items": items,
        }))
        .into_response(),
        Err(e) => provider_err_response_for(ProviderKind::Anime, e),
    }
}

async fn anime_recent(
    State(state): State<AppState>,
    Query(p): Query<AnimeBrowseParams>,
) -> Response {
    let page = p.page.unwrap_or(1);
    match state.svc.anime_client.browse("START_DATE_DESC", Some("RELEASING"), page).await {
        Ok(items) => Json(serde_json::json!({
            "sort": "recent",
            "page": page,
            "items": items,
        }))
        .into_response(),
        Err(e) => provider_err_response_for(ProviderKind::Anime, e),
    }
}

#[derive(Deserialize)]
struct CaptionsParams {
    id: String,
    #[serde(default)]
    resource_id: Option<String>,
}

async fn captions(State(state): State<AppState>, Query(p): Query<CaptionsParams>) -> Response {
    // Sibling subject ids (alternate audio/dub tracks) widen caption coverage
    // the same way the TUI does.
    let mut siblings: Vec<String> = match state.svc.details_typed(ProviderKind::MovieBox, &p.id).await {
        Ok(details) => details
            .dubs
            .iter()
            .filter(|d| d.subject_id != p.id)
            .map(|d| d.subject_id.clone())
            .collect(),
        Err(_) => Vec::new(),
    };
    siblings.truncate(3);
    let resource_id = p.resource_id.unwrap_or_default();
    match state
        .svc
        .get_ext_captions(&p.id, &resource_id, &siblings)
        .await
    {
        Ok(subtitles) => Json(serde_json::json!({
            "id": p.id,
            "subtitles": subtitles,
        }))
        .into_response(),
        Err(e) => api_error(StatusCode::BAD_GATEWAY, e),
    }
}

async fn fetch_releases(
    svc: &MovieBoxService,
    provider: ProviderKind,
    id: &str,
    season: usize,
    episode: usize,
) -> Result<Vec<Release>, ProviderError> {
    match provider {
        ProviderKind::MovieBox => {
            ReleaseProvider::episode_streams(&svc.client, id, season, episode).await
        }
        ProviderKind::FourKHdHub => match svc.fourk_client.as_ref() {
            Some(client) => ReleaseProvider::episode_streams(client, id, season, episode).await,
            None => Err(ProviderError::Unavailable(
                "4KHDHub is unavailable".to_string(),
            )),
        },
        ProviderKind::BdixCircleFtp => {
            ReleaseProvider::episode_streams(&svc.circleftp_client, id, season, episode).await
        }
        ProviderKind::BdixDhakaFlix => {
            ReleaseProvider::episode_streams(&svc.dhakaflix_client, id, season, episode).await
        }
        ProviderKind::Addons => Err(ProviderError::Unavailable(
            "addon stream resolution is not part of this API yet".to_string(),
        )),
        ProviderKind::Anime => ReleaseProvider::episode_streams(&svc.anime_client, id, season, episode).await,
    }
}

// ---------------------------------------------------------------------------
// Playback: pick a release/mirror and mint a media ticket
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PlayParams {
    provider: String,
    id: String,
    #[serde(default)]
    season: Option<usize>,
    #[serde(default)]
    episode: Option<usize>,
    #[serde(default)]
    resolution: Option<u32>,
}

#[derive(Serialize)]
struct PlayResponse {
    provider: ProviderKind,
    id: String,
    season: usize,
    episode: usize,
    release: Release,
    mirror_label: String,
    direct_file: bool,
    requires_headers: bool,
    /// Path the player should open: /api/proxy/<ticket>/a<original path+query>.
    /// DASH manifests served through it have segment URLs rewritten to stay
    /// on this server.
    play_url: String,
}

async fn play(State(state): State<AppState>, Json(req): Json<PlayParams>) -> Response {
    let provider = match provider_of(&req.provider) {
        Ok(k) => k,
        Err(e) => return e,
    };
    let season = req.season.unwrap_or(0);
    let episode = req.episode.unwrap_or(0);

    let releases = match fetch_releases(&state.svc, provider, &req.id, season, episode).await {
        Ok(r) if !r.is_empty() => r,
        Ok(_) => {
            log::warn!("play: empty releases for provider={provider} id={} s={season} ep={episode}", req.id);
            return api_error(
                StatusCode::NOT_FOUND,
                anime_or(provider, StatusCode::NOT_FOUND, "no playable releases found for this title"),
            )
        }
        Err(e) => return provider_err_response_for(provider, e),
    };

    // Pick the best release: exact resolution match first, else the
    // multi-resolution (adaptive) stream, else the first entry. Mirrors are
    // ordered by the provider; the first one wins.
    let release = if let Some(want) = req.resolution {
        releases
            .iter()
            .find(|r| !r.is_multi_resolution() && r.resolution_u64() == u64::from(want))
            .or_else(|| releases.iter().find(|r| r.is_multi_resolution()))
            .or_else(|| releases.first())
    } else {
        releases
            .iter()
            .find(|r| r.is_multi_resolution())
            .or_else(|| releases.first())
    };
    let Some(release) = release else {
        log::warn!("play: no release picked for provider={provider} id={}", req.id);
        return api_error(StatusCode::NOT_FOUND, anime_or(provider, StatusCode::NOT_FOUND, "no playable release found"));
    };
    let Some(mirror) = release.mirrors.first() else {
        log::warn!("play: release without mirrors for provider={provider} id={}", req.id);
        return api_error(StatusCode::NOT_FOUND, anime_or(provider, StatusCode::NOT_FOUND, "release has no mirrors"));
    };
    if !moviebox_tui::net::is_http_url(&mirror.resolver_url) {
        log::warn!("play: non-http mirror for provider={provider} id={}: {}", req.id, mirror.resolver_url);
        return api_error(
            StatusCode::BAD_GATEWAY,
            anime_or(provider, StatusCode::BAD_GATEWAY, &format!("mirror is not an http(s) url: {}", mirror.resolver_url)),
        );
    }

    let (ticket, origin) = state
        .tickets
        .insert(mirror.resolver_url.clone(), mirror.headers.clone());
    let requires_headers = !mirror.headers.is_empty();
    let path_and_query = if !origin.is_empty() && mirror.resolver_url.starts_with(&origin) {
        mirror.resolver_url[origin.len()..].to_string()
    } else {
        mirror.resolver_url.clone()
    };
    let play_url = format!("/api/proxy/{ticket}/a{path_and_query}");

    Json(PlayResponse {
        provider,
        id: req.id,
        season,
        episode,
        release: release.clone(),
        mirror_label: mirror.label.clone(),
        direct_file: mirror.direct_file,
        requires_headers,
        play_url,
    })
    .into_response()
}

// ---------------------------------------------------------------------------
// Media proxy
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TicketParams {
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
}

async fn create_ticket(
    State(state): State<AppState>,
    Json(req): Json<TicketParams>,
) -> Response {
    if !moviebox_tui::net::is_http_url(&req.url) {
        return api_error(StatusCode::BAD_REQUEST, "url must be an absolute http(s) url");
    }
    let (ticket, _) = state.tickets.insert(req.url, req.headers);
    Json(serde_json::json!({ "ticket": ticket })).into_response()
}

async fn proxy_fetch_foreign(state: AppState, foreign: Ticket, headers: HeaderMap) -> Response {
    let mut builder = state.proxy_client.get(&foreign.raw_url);
    for (name, value) in &foreign.headers {
        if let Ok(n) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) {
            builder = builder.header(n, value);
        }
    }
    builder = builder.header(reqwest::header::ACCEPT_ENCODING, "identity");
    if let Some(range) = headers.get(reqwest::header::RANGE) {
        builder = builder.header(reqwest::header::RANGE, range);
    }
    let resp = match builder.send().await {
        Ok(r) => r,
        Err(e) => return api_error(StatusCode::BAD_GATEWAY, format!("upstream error: {e}")),
    };
    let status = resp.status();
    let mut out = HeaderMap::new();
    const PASS: [&str; 6] = [
        "content-type",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
        "cache-control",
    ];
    for name in PASS {
        if let Some(v) = resp.headers().get(name) {
            let n = axum::http::HeaderName::from_static(name);
            out.insert(n, v.clone());
        }
    }
    if let Some(len) = resp.content_length() {
        out.insert(
            axum::http::header::CONTENT_LENGTH,
            axum::http::HeaderValue::from_str(&len.to_string()).unwrap(),
        );
    }
    let stream = resp.bytes_stream();
    (status, out, Body::from_stream(stream)).into_response()
}

async fn proxy_fetch_inner_foreign(state: AppState, foreign: Ticket, headers: HeaderMap) -> Response {
    proxy_fetch_foreign(state, foreign, headers).await
}

async fn proxy_fetch_root(
    State(state): State<AppState>,
    Path(ticket): Path<String>,
    headers: HeaderMap,
) -> Response {
    proxy_fetch_inner(state, ticket, String::new(), headers).await
}

async fn proxy_fetch(
    State(state): State<AppState>,
    Path((ticket, rest)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    proxy_fetch_inner(state, ticket, rest, headers).await
}

async fn proxy_fetch_inner(
    state: AppState,
    ticket: String,
    rest: String,
    headers: HeaderMap,
) -> Response {
    let Some(t) = state.tickets.get(&ticket) else {
        return api_error(StatusCode::NOT_FOUND, "unknown or expired ticket");
    };

    // Resolve the upstream URL:
    //   rest == ""        -> the ticket's original URL
    //   rest starts "a/"  -> absolute path under the origin host
    //   anything else     -> relative to the original URL's directory
    let upstream = if rest.is_empty() {
        t.raw_url.clone()
    } else if let Some(abs) = rest.strip_prefix("a/") {
        if abs.is_empty() || t.origin.is_empty() {
            return api_error(StatusCode::BAD_REQUEST, "bad proxy path");
        }
        // A foreign-ticket reference minted by the HLS rewrite for a
        // cross-host segment URL: resolve it to the stored upstream URL and
        // adopt ITS headers (provider-required Referer/UA).
        if let Some(foreign) = state.tickets.get(abs) {
            return proxy_fetch_inner_foreign(state, foreign, headers).await;
        }
        if abs.starts_with("http://") || abs.starts_with("https://") {
            abs.to_string()
        } else {
            format!("{}/{}", t.origin, abs)
        }
    } else if rest.starts_with("http://") || rest.starts_with("https://") {
        // The HLS rewrite emits fully-qualified rewritten URLs when the
        // upstream playlist references a different host/port (multi-CDN);
        // the proxy path then carries the whole URL after /a/.
        rest.clone()
    } else {
        let base = t
            .raw_url
            .rsplit_once('/')
            .map(|(dir, _)| dir.to_string())
            .unwrap_or_else(|| t.raw_url.clone());
        format!("{base}/{rest}")
    };

    let mut builder = state.proxy_client.get(&upstream);
    for (name, value) in &t.headers {
        if let Ok(n) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) {
            builder = builder.header(n, value);
        }
    }
    builder = builder.header(reqwest::header::ACCEPT_ENCODING, "identity");
    if let Some(range) = headers.get(reqwest::header::RANGE) {
        builder = builder.header(reqwest::header::RANGE, range);
    }

    let resp = match builder.send().await {
        Ok(r) => r,
        Err(e) => return api_error(StatusCode::BAD_GATEWAY, format!("upstream error: {e}")),
    };
    let status = resp.status();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_manifest = status.is_success()
        && (upstream.ends_with(".mpd")
            || upstream.ends_with(".m3u8")
            || content_type.contains("dash+xml")
            || content_type.contains("mpegurl")
            || content_type.contains("vnd.apple.mpegurl"));

    let mut out = HeaderMap::new();
    const PASS: [&str; 6] = [
        "content-type",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
        "cache-control",
    ];
    for name in PASS {
        if let Some(v) = resp.headers().get(name) {
            let n = axum::http::HeaderName::from_static(name);
            out.insert(n, v.clone());
        }
    }

    // DASH manifests: rewrite absolute URLs of the ticket's origin so the
    // player fetches every segment through this proxy.
    if is_manifest && !t.origin.is_empty() {
        let bytes = match resp.bytes().await {
            Ok(b) if b.len() <= 16 * 1024 * 1024 => b,
            _ => {
                return api_error(
                    StatusCode::BAD_GATEWAY,
                    "manifest unreadable or too large",
                )
            }
        };
        let base = format!(
            "{}/api/proxy/{ticket}/a",
            state.proxy_base.trim_end_matches('/')
        );
        // Determine if this is an HLS manifest (needs relative URL rewriting)
        let is_hls = upstream.ends_with(".m3u8") || content_type.contains("mpegurl") || content_type.contains("vnd.apple.mpegurl");
        
        // Determine the directory prefix for resolving relative URLs in HLS manifests.
        // e.g. if upstream is http://host/stream/id/master.m3u8, dir is /stream/id/
        let upstream_path = if is_hls {
            upstream
                .split_once("://")
                .and_then(|(_, rest)| rest.find('/').map(|idx| &rest[idx..]))
                .and_then(|path| path.rsplit_once('/').map(|(dir, _)| dir.to_string()))
                .unwrap_or_default()
        } else {
            String::new()
        };
        let proxy_dir = format!("{base}{upstream_path}/");

        let text = if is_hls {
            // HLS: rewrite relative URLs line-by-line
            String::from_utf8_lossy(&bytes)
                .lines()
                .map(|line| {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        return line.to_string();
                    }
                    // Rewrite absolute upstream URLs (same origin).
                    if trimmed.starts_with(&t.origin) {
                        return line.replacen(&t.origin, &base, 1);
                    }
                    // Rewrite absolute URLs on OTHER hosts: issue a ticket for
                    // the foreign URL and route through this same proxy so the
                    // provider-required headers still attach. Tickets are
                    // content-addressed per (url, headers) upstream so repeat
                    // fetches reuse them instead of evicting live tickets.
                    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                        let (foreign_ticket, _) = state
                            .tickets
                            .insert_dedup(trimmed.to_string(), t.headers.clone());
                        return format!("{base}/{foreign_ticket}");
                    }
                    // Rewrite relative URLs (e.g. "seg/0" or "360p.m3u8")
                    if !trimmed.starts_with('/') {
                        return format!("{proxy_dir}{trimmed}");
                    }
                    line.to_string()
                })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            // DASH/Other: simple origin replacement only (preserve XML structure)
            String::from_utf8_lossy(&bytes).replace(&t.origin, &base)
        };
        // Preserve original content-type for HLS, override for DASH if missing
        let final_content_type = if content_type.contains("mpegurl") || content_type.contains("vnd.apple.mpegurl") {
            content_type.to_string()
        } else {
            "application/dash+xml".to_string()
        };
        out.insert(
            axum::http::header::CONTENT_TYPE,
            HeaderValue::from_str(&final_content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")),
        );
        out.insert(
            axum::http::header::CONTENT_LENGTH,
            HeaderValue::from_str(&text.len().to_string()).unwrap(),
        );
        return (StatusCode::OK, out, Body::from(text.into_bytes())).into_response();
    }

    if let Some(len) = resp.content_length() {
        out.insert(
            axum::http::header::CONTENT_LENGTH,
            HeaderValue::from_str(&len.to_string()).unwrap(),
        );
    }
    let stream = resp.bytes_stream();
    (status, out, Body::from_stream(stream)).into_response()
}

// ---------------------------------------------------------------------------
// Transcode gateway: HEVC-only DASH -> playable H.264 HLS via ffmpeg
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TranscodeStartParams {
    ticket: String,
}

/// Probe for a usable ffmpeg binary: an explicitly configured
/// `MOVIEBOX_FFMPEG_PATH` wins (missing configured path -> not found);
/// otherwise a `which`-style walk over PATH for `ffmpeg`.
async fn resolve_ffmpeg() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MOVIEBOX_FFMPEG_PATH") {
        if !p.trim().is_empty() {
            let p = PathBuf::from(p.trim());
            let is_file = tokio::fs::metadata(&p).await.map(|m| m.is_file()).unwrap_or(false);
            return is_file.then_some(p);
        }
    }
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let candidate = dir.join("ffmpeg");
        if tokio::fs::metadata(&candidate).await.map(|m| m.is_file()).unwrap_or(false) {
            return Some(candidate);
        }
    }
    None
}

/// Build the ffmpeg HLS command line for the given manifest URL / output dir.
fn transcode_args(
    cfg: &TranscodeConfig,
    manifest_url: &str,
    dir: &std::path::Path,
    offset_seconds: Option<f64>,
) -> Vec<String> {
    let segment_pattern = dir.join("seg%05d.ts");
    let mut args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-y".to_string(),
    ];
    // Fast seek: `-ss` BEFORE `-i` seeks the demuxer instead of post-decoding.
    if let Some(offset) = offset_seconds {
        if offset > 0.0 {
            args.push("-ss".to_string());
            args.push(format!("{offset}"));
        }
    }
    args.extend(vec![
        "-i".to_string(),
        manifest_url.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "0:a:0".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        cfg.preset.clone(),
        "-crf".to_string(),
        cfg.crf.clone(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-profile:v".to_string(),
        "main".to_string(),
        "-level".to_string(),
        "4.0".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-ac".to_string(),
        "2".to_string(),
        "-b:a".to_string(),
        "128k".to_string(),
        "-f".to_string(),
        "hls".to_string(),
        "-hls_time".to_string(),
        "6".to_string(),
        "-hls_list_size".to_string(),
        "0".to_string(),
        "-hls_flags".to_string(),
        "independent_segments+temp_file".to_string(),
        "-hls_segment_filename".to_string(),
        segment_pattern.to_string_lossy().into_owned(),
        dir.join("index.m3u8").to_string_lossy().into_owned(),
    ]);
    args
}

/// Background drain of ffmpeg's stderr/stdout; never blocks request handlers.
fn spawn_ffmpeg_drain<R>(reader: R, tag: String)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::task::spawn(async move {
        let mut lines = tokio::io::BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::debug!("transcode[{tag}]: {line}");
        }
    });
}

/// Parse a W3C/ISO-8601 duration ("PT2H28M7.9S", "PT3M", "PT0S", optionally
/// "P0DT2H28M7.9S") into whole seconds. `S` may be fractional; only D/H/M/S
/// designators are accepted. Returns None when unparseable.
fn iso8601_duration_to_seconds(raw: &str) -> Option<f64> {
    let rest = raw.strip_prefix('P')?;
    // The date/time separator ('T' in PT2H28M7.9S / P0DT2H28M7.9S) carries no
    // value of its own; drop it so D/H/M/S components parse uniformly.
    let rest: String = rest.chars().filter(|c| *c != 'T').collect();
    if rest.is_empty() {
        return None;
    }
    let mut seconds = 0.0f64;
    let mut idx = 0;
    let bytes = rest.as_bytes();
    let mut saw_component = false;
    while idx < bytes.len() {
        let start = idx;
        while idx < bytes.len()
            && (bytes[idx].is_ascii_digit() || bytes[idx] == b'.' || bytes[idx] == b',')
        {
            idx += 1;
        }
        if idx == start {
            return None; // stray non-numeric character (e.g. weeks 'W')
        }
        let value: f64 = rest[start..idx].replace(',', ".").parse().ok()?;
        let unit = *bytes.get(idx)?;
        idx += 1;
        let mult = match unit {
            b'D' => 86_400.0,
            b'H' => 3_600.0,
            b'M' => 60.0,
            b'S' => 1.0,
            _ => return None,
        };
        seconds += value * mult;
        saw_component = true;
    }
    saw_component.then_some(seconds)
}

/// Pull `mediaPresentationDuration="PT#H#M#S"` out of an MPD manifest.
fn parse_mpd_duration(text: &str) -> Option<f64> {
    let needle = "mediaPresentationDuration";
    let at = text.find(needle)?;
    let rest = &text[at + needle.len()..];
    let quote_idx = rest.find(|c| c == '"' || c == '\'')?;
    let quote = rest[quote_idx..].chars().next()?;
    let inner = &rest[quote_idx + quote.len_utf8()..];
    let value = inner.split(quote).next()?;
    iso8601_duration_to_seconds(value.trim())
}

/// Fetch the source manifest through the same header-injecting proxy ffmpeg
/// consumes and read the total duration off `mediaPresentationDuration`.
async fn probe_source_duration(client: &reqwest::Client, manifest_url: &str) -> Option<f64> {
    let resp = client
        .get(manifest_url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.len() > 2 * 1024 * 1024 {
        return None;
    }
    parse_mpd_duration(&String::from_utf8_lossy(&bytes))
}

/// Sum of the `#EXTINF` durations in the session playlist: seconds of media
/// produced so far. 0.0 when the playlist is absent or holds no EXTINF rows.
/// Sync + tiny by design so callers may run it under the map lock.
fn produced_seconds_in(dir: &std::path::Path) -> f64 {
    let Ok(text) = std::fs::read_to_string(dir.join("index.m3u8")) else {
        return 0.0;
    };
    let mut sum = 0.0f64;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("#EXTINF:") {
            if let Some(value) = rest.split(',').next() {
                if let Ok(v) = value.trim().parse::<f64>() {
                    sum += v;
                }
            }
        }
    }
    sum
}

/// Remove every segment file and the playlist in a session dir so a seek
/// restart begins from a clean slate. Leaves unrelated files alone.
async fn wipe_transcode_outputs(dir: &std::path::Path) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let is_output = name == "index.m3u8"
            || (name.starts_with("seg")
                && (name.ends_with(".ts") || name.ends_with(".tmp")));
        if is_output {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
}

/// Kill (if alive), reap, and remove the session's directory.
async fn cleanup_transcode_session(session: TranscodeSession, base_dir: &std::path::Path) {
    let mut child = session.child;
    if let Some(c) = child.as_mut() {
        let _ = c.kill().await;
        let _ = c.wait().await;
    }
    drop(child);
    if let Err(e) = tokio::fs::remove_dir_all(&session.dir).await {
        if e.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "transcode[{}]: failed removing dir {}: {e}",
                session.ticket,
                session.dir.display()
            );
        }
    }
    // Best-effort removal of the (possibly empty) base dir.
    let _ = tokio::fs::remove_dir(base_dir).await;
}

/// Background watcher: notices when the session's ffmpeg exits (naturally or
/// by crash), records `child = None` (files stay servable), and stops once
/// the session leaves the registry (DELETE / janitor). While running it keeps
/// the session's `produced_seconds` fresh from the playlist and captures a
/// final sample when ffmpeg exits, so `/state` reports produced == duration
/// once a transcode completes. It deliberately survives natural exit so a
/// later seek can restart the pipeline under the same session id; `try_wait`
/// is synchronous, so the map lock is only ever held across quick non-await
/// sections.
fn spawn_transcode_watcher(store: Arc<TranscodeStore>, session_id: String) {
    tokio::task::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let exited = {
                let mut map = store.inner.lock();
                let Some(s) = map.get_mut(&session_id) else { return };
                // The m3u8 read is synchronous and tiny; safe under the lock.
                let fresh = produced_seconds_in(&s.dir);
                if s.restarting {
                    // A seek restart is tearing down the pipeline: keep the
                    // pre-seek sample until the fresh playlist reappears.
                } else if fresh > 0.0 {
                    s.produced_seconds = s.produced_base + fresh;
                }
                match s.child.as_mut() {
                    Some(c) => match c.try_wait() {
                        Ok(Some(_)) => {
                            let final_produced = if s.restarting {
                                s.produced_seconds
                            } else {
                                s.produced_base + fresh.max(s.produced_seconds - s.produced_base)
                            };
                            s.child = None;
                            s.produced_seconds = final_produced;
                            true
                        }
                        _ => false,
                    },
                    None => false,
                }
            };
            if exited {
                log::debug!("transcode[{session_id}]: ffmpeg exited (files remain servable)");
            }
        }
    });
}

async fn transcode_start(
    State(state): State<AppState>,
    Json(req): Json<TranscodeStartParams>,
) -> Response {
    if !state.transcode_cfg.enabled {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "transcoding is disabled (TRANSCODE_ENABLED=0)",
        );
    }
    let Some(ticket) = state.tickets.get(&req.ticket) else {
        return api_error(StatusCode::NOT_FOUND, "unknown or expired ticket");
    };

    // Janitor: drop sessions idle for longer than the TTL.
    {
        let mut map = state.transcodes.inner.lock();
        let stale = TranscodeStore::prune_locked(&mut map);
        if !stale.is_empty() {
            let base = state.transcode_cfg.base_dir.clone();
            drop(map);
            for s in stale {
                let base = base.clone();
                tokio::task::spawn(async move {
                    cleanup_transcode_session(s, &base).await;
                });
            }
        }
    }

    // Session must be unique per ticket: reject while one is live/expiring.
    {
        let map = state.transcodes.inner.lock();
        if let Some((id, _)) = map
            .iter()
            .find(|(_, s)| s.ticket == req.ticket)
            .map(|(id, s)| (id.clone(), s.started))
        {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "error": "transcode session already exists for ticket",
                    "session": id,
                })),
            )
                .into_response();
        }
    }

    // Reject before touching state when ffmpeg is unavailable.
    let Some(ffmpeg) = resolve_ffmpeg().await else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "ffmpeg is required for transcoding (not found: '{}' and no ffmpeg on PATH)",
                state.transcode_cfg.ffmpeg_path
            ),
        );
    };

    // Resolve the source manifest URL: prefer the header-injecting proxy
    // (same server) so ffmpeg needs no cookies of its own.
    let raw_url = ticket.raw_url.clone();
    let manifest_url = if !ticket.origin.is_empty() && raw_url.starts_with(&ticket.origin) {
        let path_and_query = &raw_url[ticket.origin.len()..];
        format!(
            "http://127.0.0.1:{}/api/proxy/{}/a{path_and_query}",
            state.transcode_cfg.proxy_port, req.ticket
        )
    } else if moviebox_tui::net::is_http_url(&raw_url) {
        raw_url.clone()
    } else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "ticket url is not an http(s) url and cannot be proxied",
        );
    };

    // Total source length, read from the manifest through the same proxy URL
    // ffmpeg consumes (best-effort; None keeps clients on the live-window
    // behaviour when the duration cannot be determined).
    let source_duration = probe_source_duration(&state.proxy_client, &manifest_url).await;
    log::debug!(
        "transcode: manifest duration for ticket {}: {:?}",
        req.ticket,
        source_duration
    );

    // Unique session id, non-colliding with the registry.
    let session_id = loop {
        let candidate = random_hex(20);
        if !state.transcodes.inner.lock().contains_key(&candidate) {
            break candidate;
        }
    };

    // Session dir lives under the configurable base. Insert the session
    // BEFORE spawning ffmpeg (deadlock rule: never hold the lock across the
    // spawn or any await that can stall handlers); remove it on spawn error.
    let dir = state.transcode_cfg.base_dir.join(&session_id);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        return api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("cannot create transcode dir {}: {e}", dir.display()),
        );
    }
    {
        let mut map = state.transcodes.inner.lock();
        map.insert(
            session_id.clone(),
            TranscodeSession {
                ticket: req.ticket.clone(),
                manifest_url: manifest_url.clone(),
                dir: dir.clone(),
                child: None,
                last_used: Instant::now(),
                started: Instant::now(),
                duration_seconds: source_duration,
                produced_seconds: 0.0,
                produced_base: 0.0,
                restarting: false,
            },
        );
    }

    // Spawn ffmpeg itself (stdin null; stdout/stderr drained in background).
    // No lock is held across the spawn or across any await below.
    let spawn_result = {
        let mut command = tokio::process::Command::new(&ffmpeg);
        command
            .args(transcode_args(
                &state.transcode_cfg,
                &manifest_url,
                &dir,
                None,
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command.spawn()
    };

    match spawn_result {
        Ok(mut child) => {
            let tag = session_id.clone();
            if let Some(out) = child.stdout.take() {
                spawn_ffmpeg_drain(out, tag.clone());
            }
            if let Some(err) = child.stderr.take() {
                spawn_ffmpeg_drain(err, tag);
            }
            let store = state.transcodes.clone();
            {
                let mut map = store.inner.lock();
                if let Some(s) = map.get_mut(&session_id) {
                    s.child = Some(child);
                }
            }
            // Watch for natural exit once the child is registered.
            spawn_transcode_watcher(store, session_id.clone());
            log::info!(
                "transcode[{session_id}]: started ffmpeg {} for ticket {} -> {}",
                ffmpeg.display(),
                req.ticket,
                dir.display()
            );
            Json(serde_json::json!({
                "session": session_id,
                "m3u8_url": format!("/api/transcode/{session_id}/index.m3u8"),
            }))
            .into_response()
        }
        Err(e) => {
            // Spawn failed (e.g. binary missing at the resolved path):
            // remove the session and its dir.
            let failed = {
                let mut map = state.transcodes.inner.lock();
                map.remove(&session_id)
            };
            if let Some(s) = failed {
                let base = state.transcode_cfg.base_dir.clone();
                tokio::task::spawn(async move {
                    cleanup_transcode_session(s, &base).await;
                });
            }
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                format!("failed to start ffmpeg: {e}"),
            )
        }
    }
}

fn valid_transcode_filename(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.') {
        return false;
    }
    if name == "index.m3u8" {
        return true;
    }
    // segNNNNN.ts (5-digit sequence from -hls_segment_filename seg%05d.ts).
    name.len() == 11
        && name.starts_with("seg")
        && name.ends_with(".ts")
        && name.as_bytes()[3..8].iter().all(u8::is_ascii_digit)
}

async fn transcode_state(
    State(state): State<AppState>,
    Path(session): Path<String>,
) -> Response {
    let (snapshot, stale) = {
        let mut map = state.transcodes.inner.lock();
        let stale = TranscodeStore::prune_locked(&mut map);
        let Some(s) = map.get_mut(&session) else {
            return api_error(StatusCode::NOT_FOUND, "unknown transcode session");
        };
        s.last_used = Instant::now();
        let snapshot = (
            s.ticket.clone(),
            s.dir.clone(),
            s.child.is_some(),
            s.duration_seconds,
            s.produced_seconds,
            s.produced_base,
            s.restarting,
        );
        (snapshot, stale)
    };
    for s in stale {
        let base = state.transcode_cfg.base_dir.clone();
        tokio::task::spawn(async move {
            cleanup_transcode_session(s, &base).await;
        });
    }
    let (ticket, dir, running, duration_seconds, stored_produced, produced_base, restarting) =
        snapshot;
    let playlist = tokio::fs::metadata(dir.join("index.m3u8")).await.is_ok();
    let segments = match tokio::fs::read_dir(&dir).await {
        Ok(mut entries) => {
            let mut count = 0usize;
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.path().extension().is_some_and(|e| e == "ts") {
                    count += 1;
                }
            }
            count
        }
        Err(_) => 0,
    };
    // Fresh produced sample from the playlist, in content-absolute terms
    // (base offset of the current pipeline + EXTINF sum). Stored keeps the
    // watcher's monotonic view; while a seek restart is in flight the stored
    // (pre-restart) sample is reported so the value never regresses.
    let produced_seconds = if restarting {
        stored_produced
    } else {
        let fresh = produced_base + produced_seconds_in(&dir);
        fresh.max(stored_produced)
    };
    {
        let mut map = state.transcodes.inner.lock();
        if let Some(s) = map.get_mut(&session) {
            if !s.restarting {
                s.produced_seconds = produced_seconds;
            }
        }
    }
    Json(serde_json::json!({
        "session": session,
        "running": running,
        "ready": playlist,
        "segments": segments,
        "ticket": ticket,
        "duration_seconds": duration_seconds,
        "produced_seconds": produced_seconds,
        "restarting": restarting,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct TranscodeSeekParams {
    position_seconds: f64,
}

/// Restart the session's ffmpeg pipeline at an absolute offset into the
/// source: stop the running child, wipe the previous segments/playlist, and
/// re-spawn with `-ss <position>` placed BEFORE `-i` (fast seek). The session
/// id, directory and ticket stay unchanged; new segments begin at 00000.
/// While a restart is in flight the session reports `restarting: true`; a
/// concurrent seek on the same session gets 409.
async fn transcode_seek(
    State(state): State<AppState>,
    Path(session): Path<String>,
    Json(req): Json<TranscodeSeekParams>,
) -> Response {
    if !state.transcode_cfg.enabled {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "transcoding is disabled (TRANSCODE_ENABLED=0)",
        );
    }
    if !req.position_seconds.is_finite() || req.position_seconds < 0.0 {
        return api_error(
            StatusCode::BAD_REQUEST,
            "position_seconds must be a finite, non-negative number",
        );
    }

    // Serialize restarts per session: `restarting` is checked and set under
    // the registry lock, so a second concurrent seek fails fast with 409
    // instead of racing the teardown. Resetting produced happens atomically
    // with the flag.
    let (ticket, manifest_url, dir, duration_seconds) = {
        let mut map = state.transcodes.inner.lock();
        let Some(s) = map.get_mut(&session) else {
            return api_error(StatusCode::NOT_FOUND, "unknown transcode session");
        };
        if s.restarting {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "error": "a seek restart is already in progress for this session",
                    "restarting": true,
                })),
            )
                .into_response();
        }
        if let Some(d) = s.duration_seconds {
            if req.position_seconds >= d {
                return api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!(
                        "position_seconds {} is at or beyond the source duration {d}",
                        req.position_seconds
                    ),
                );
            }
        }
        s.last_used = Instant::now();
        s.restarting = true;
        s.produced_base = req.position_seconds;
        // Keep the pre-restart absolute sample while `restarting` is true so
        // /state never reports a regression; the watcher re-anchors from the
        // new playlist once segments reappear.
        (
            s.ticket.clone(),
            s.manifest_url.clone(),
            s.dir.clone(),
            s.duration_seconds,
        )
    };

    // ffmpeg must be resolvable before we tear anything down; otherwise
    // cancel the restart and leave the previous state intact.
    let Some(ffmpeg) = resolve_ffmpeg().await else {
        let mut map = state.transcodes.inner.lock();
        if let Some(s) = map.get_mut(&session) {
            s.restarting = false;
        }
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "ffmpeg is required for transcoding (not found: '{}' and no ffmpeg on PATH)",
                state.transcode_cfg.ffmpeg_path
            ),
        );
    };

    // Take the current child out of the registry and stop it. The watcher
    // sees `child = None` meanwhile and simply keeps polling.
    let mut old_child = {
        let mut map = state.transcodes.inner.lock();
        match map.get_mut(&session) {
            Some(s) => s.child.take(),
            None => {
                return api_error(StatusCode::NOT_FOUND, "unknown transcode session")
            }
        }
    };
    if let Some(child) = old_child.as_mut() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    drop(old_child);

    // Wipe previous outputs so the new playlist starts from a clean slate
    // (the killed child may still hold its last segment file open).
    wipe_transcode_outputs(&dir).await;

    // Re-spawn ffmpeg exactly like the start flow, plus the fast-seek offset.
    let spawn_result = {
        let mut command = tokio::process::Command::new(&ffmpeg);
        command
            .args(transcode_args(
                &state.transcode_cfg,
                &manifest_url,
                &dir,
                Some(req.position_seconds),
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command.spawn()
    };

    match spawn_result {
        Ok(mut child) => {
            let tag = session.clone();
            if let Some(out) = child.stdout.take() {
                spawn_ffmpeg_drain(out, tag.clone());
            }
            if let Some(err) = child.stderr.take() {
                spawn_ffmpeg_drain(err, tag);
            }
            {
                let mut map = state.transcodes.inner.lock();
                match map.get_mut(&session) {
                    Some(s) => {
                        s.child = Some(child);
                        s.restarting = false;
                    }
                    // Session was deleted mid-restart: `child` drops here
                    // (kill_on_drop) and DELETE already removed the dir.
                    None => {
                        return api_error(
                            StatusCode::NOT_FOUND,
                            "unknown transcode session",
                        )
                    }
                }
            }
            log::info!(
                "transcode[{session}]: seek to {}s restarted ffmpeg for ticket {} -> {}",
                req.position_seconds,
                ticket,
                dir.display()
            );
            Json(serde_json::json!({
                "session": session,
                "m3u8_url": format!("/api/transcode/{session}/index.m3u8"),
                "duration_seconds": duration_seconds,
                "produced_seconds": req.position_seconds,
                "restarting": false,
            }))
            .into_response()
        }
        Err(e) => {
            // Respawn failed: leave the session registered without a child so
            // the client can DELETE it or retry; clear the restart flag.
            let mut map = state.transcodes.inner.lock();
            if let Some(s) = map.get_mut(&session) {
                s.child = None;
                s.restarting = false;
            }
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                format!("failed to restart ffmpeg: {e}"),
            )
        }
    }
}

async fn transcode_file(
    State(state): State<AppState>,
    Path((session, name)): Path<(String, String)>,
) -> Response {
    let dir = {
        let mut map = state.transcodes.inner.lock();
        let Some(s) = map.get_mut(&session) else {
            return api_error(StatusCode::NOT_FOUND, "unknown transcode session");
        };
        s.last_used = Instant::now();
        s.dir.clone()
    };
    if !valid_transcode_filename(&name) {
        return api_error(StatusCode::NOT_FOUND, "unknown transcode file");
    }
    let path = dir.join(&name);
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return api_error(StatusCode::NOT_FOUND, "transcode file not ready");
        }
        Err(e) => {
            return api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("cannot read {}: {e}", path.display()),
            )
        }
    };
    let content_type = if name.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else if name.ends_with(".ts") {
        "video/mp2t"
    } else {
        "application/octet-stream"
    };
    (
        StatusCode::OK,
        [
            (
                axum::http::header::CONTENT_TYPE,
                HeaderValue::from_static(content_type),
            ),
            (
                axum::http::header::CONTENT_LENGTH,
                HeaderValue::from_str(&bytes.len().to_string()).unwrap(),
            ),
        ],
        Body::from(bytes),
    )
        .into_response()
}

async fn transcode_delete(
    State(state): State<AppState>,
    Path(session): Path<String>,
) -> Response {
    let removed = {
        let mut map = state.transcodes.inner.lock();
        map.remove(&session)
    };
    let Some(s) = removed else {
        return api_error(StatusCode::NOT_FOUND, "unknown transcode session");
    };
    let base = state.transcode_cfg.base_dir.clone();
    // Kill + reap the child synchronously (it is our session), then drop dir.
    cleanup_transcode_session(s, &base).await;
    log::info!("transcode[{session}]: removed by DELETE");
    Json(serde_json::json!({ "removed": true })).into_response()
}

// ---------------------------------------------------------------------------
// Local desktop history / favourites
//
// Read-only views over the TUI's own persistence files, so a signed-in account
// can import what this machine watched. The files are read directly rather
// than through `HistoryManager`/`FavoritesManager`, which rotate corrupt files
// and re-save on load; every failure degrades to an empty 200 payload because
// an importer must never be blocked by a missing or damaged local store.
// ---------------------------------------------------------------------------

/// Max rows handed to an importer; the desktop store itself is unbounded.
const LOCAL_HISTORY_LIMIT: usize = 200;

/// One row of the on-disk `watched` list. Current builds store only the
/// completed-index keys (`provider::subject::season::episode`); older ones
/// stored full entries, so both shapes must decode.
#[derive(Deserialize)]
#[serde(untagged)]
enum WatchedRow {
    Entry(moviebox_tui::history::WatchHistoryItem),
    Key(String),
}

#[derive(Default, Deserialize)]
struct HistoryFile {
    #[serde(default)]
    watched: Vec<WatchedRow>,
    #[serde(default)]
    recent: Vec<moviebox_tui::history::WatchHistoryItem>,
}

#[derive(Default, Deserialize)]
struct FavoritesFile {
    #[serde(default)]
    items: Vec<FavoriteRow>,
}

/// Tolerant mirror of `moviebox_tui::favorites::FavoriteItem`: `added_at` is
/// optional so an older or hand-made file still yields usable items.
#[derive(Deserialize)]
struct FavoriteRow {
    provider: String,
    subject_id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover_url: Option<String>,
    #[serde(default)]
    stype: i64,
    #[serde(default)]
    release_year: String,
    #[serde(default)]
    added_at: Option<u64>,
}

/// Mirrors the account contract's `WatchEntry` (src/lib/account.ts).
#[derive(Serialize)]
struct LocalWatchEntry {
    provider: String,
    id: String,
    title: String,
    poster: Option<String>,
    #[serde(rename = "mediaType")]
    media_type: &'static str,
    year: Option<String>,
    season: usize,
    episode: usize,
    /// Seconds watched.
    position: f64,
    /// Total duration in seconds; 0 when the client never recorded one.
    duration: f64,
    /// Unix ms of the last update.
    #[serde(rename = "updatedAt")]
    updated_at: u64,
}

/// Mirrors the account contract's `MyListItem`.
#[derive(Serialize)]
struct LocalFavoriteEntry {
    provider: String,
    id: String,
    title: String,
    poster: Option<String>,
    #[serde(rename = "mediaType")]
    media_type: &'static str,
    year: Option<String>,
    /// Unix ms the item was added.
    #[serde(rename = "addedAt")]
    added_at: u64,
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// `stype == 2` is a series in the provider taxonomy.
fn media_type_of(stype: i64) -> &'static str {
    if stype == 2 { "series" } else { "movie" }
}

/// Absent release years are `null` in the account contract, not `""`.
fn year_of(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Canonical provider key, shared by the crate's history index and the web
/// account contract; unknown providers pass through untouched.
fn canon_provider(raw: &str) -> String {
    ProviderKind::parse(raw)
        .map(|kind| kind.cache_key().to_string())
        .unwrap_or_else(|| raw.to_string())
}

/// Same identity the crate's `watched` index is keyed by.
fn history_key(item: &moviebox_tui::history::WatchHistoryItem) -> String {
    format!(
        "{}::{}::{}::{}",
        canon_provider(&item.provider),
        item.subject_id,
        item.season,
        item.episode
    )
}

/// Parse a JSON file, yielding `T::default()` when it is missing, unreadable
/// or malformed.
fn load_local_json<T: Default + serde::de::DeserializeOwned>(path: &Option<PathBuf>) -> T {
    path.as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// The path the payload was read from (for transparency), or None when this
/// machine has no such file yet.
fn local_source(path: &Option<PathBuf>) -> Option<String> {
    path.as_ref()
        .filter(|p| p.exists())
        .map(|p| p.display().to_string())
}

async fn local_history() -> Json<serde_json::Value> {
    let path = moviebox_tui::config::history_path();
    let source = local_source(&path);
    let file: HistoryFile = load_local_json(&path);

    // `watched` is the completed index; its keys also mark the matching
    // `recent` row as completed (the TUI does the same on load).
    let mut rows: Vec<moviebox_tui::history::WatchHistoryItem> = Vec::new();
    let mut completed: HashSet<String> = HashSet::new();
    for row in file.watched {
        match row {
            WatchedRow::Entry(mut item) => {
                item.completed = true;
                rows.push(item);
            }
            WatchedRow::Key(key) => {
                completed.insert(key);
            }
        }
    }
    rows.extend(file.recent);
    rows.retain(|item| !item.completed && !completed.contains(&history_key(item)));

    // Dedupe by (provider, id, season, episode), keeping the newest timestamp.
    let mut newest: HashMap<
        (String, String, usize, usize),
        moviebox_tui::history::WatchHistoryItem,
    > = HashMap::new();
    for item in rows {
        let key = (
            canon_provider(&item.provider),
            item.subject_id.clone(),
            item.season,
            item.episode,
        );
        let keep = match newest.get(&key) {
            Some(prev) => item.timestamp >= prev.timestamp,
            None => true,
        };
        if keep {
            newest.insert(key, item);
        }
    }

    let mut entries: Vec<LocalWatchEntry> = newest
        .into_values()
        .map(|item| LocalWatchEntry {
            provider: canon_provider(&item.provider),
            id: item.subject_id,
            title: item.title,
            poster: item.cover_url,
            media_type: media_type_of(item.stype),
            year: year_of(&item.release_year),
            season: item.season,
            episode: item.episode,
            position: item.progress_seconds as f64,
            duration: item.duration_seconds.unwrap_or(0) as f64,
            updated_at: item.timestamp.saturating_mul(1000),
        })
        .collect();
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    entries.truncate(LOCAL_HISTORY_LIMIT);

    Json(serde_json::json!({
        "source": source,
        "count": entries.len(),
        "entries": entries,
    }))
}

async fn local_favorites() -> Json<serde_json::Value> {
    let path = moviebox_tui::config::favorites_path();
    let source = local_source(&path);
    let file: FavoritesFile = load_local_json(&path);
    let now_ms = now_unix_secs().saturating_mul(1000);

    let items: Vec<LocalFavoriteEntry> = file
        .items
        .into_iter()
        .map(|item| LocalFavoriteEntry {
            provider: canon_provider(&item.provider),
            id: item.subject_id,
            title: item.title,
            poster: item.cover_url,
            media_type: media_type_of(item.stype),
            year: year_of(&item.release_year),
            added_at: item
                .added_at
                .map(|ts| ts.saturating_mul(1000))
                .unwrap_or(now_ms),
        })
        .collect();

    Json(serde_json::json!({
        "source": source,
        "count": items.len(),
        "items": items,
    }))
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let providers: Vec<serde_json::Value> = [
        ProviderKind::MovieBox,
        ProviderKind::FourKHdHub,
        ProviderKind::BdixCircleFtp,
        ProviderKind::BdixDhakaFlix,
        ProviderKind::Addons,
        ProviderKind::Anime,
    ]
    .into_iter()
    .map(|kind| {
        serde_json::json!({
            "key": kind.cache_key(),
            "label": kind.label(),
            "capabilities": state.svc.capabilities(kind),
        })
    })
    .collect();
    Json(serde_json::json!({
        "ok": true,
        "service": "moviebox-server",
        "version": env!("CARGO_PKG_VERSION"),
        "region": moviebox_tui::config::moviebox_region(),
        "providers": providers,
    }))
}

async fn get_config() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "config": moviebox_tui::config::load(),
        "paths": {
            "config_dir": moviebox_tui::config::config_dir().map(|p| p.display().to_string()),
            "data_dir": moviebox_tui::config::data_dir().map(|p| p.display().to_string()),
            "cache_dir": moviebox_tui::config::cache_dir().display().to_string(),
            "addons": moviebox_tui::config::addons_path().map(|p| p.display().to_string()),
            "tv": moviebox_tui::config::tv_path().map(|p| p.display().to_string()),
            "local_history_path": moviebox_tui::config::history_path().map(|p| p.display().to_string()),
            "local_favorites_path": moviebox_tui::config::favorites_path().map(|p| p.display().to_string()),
        }
    }))
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("moviebox_server=info,warn"),
    )
    .init();

    let host = std::env::var("MOVIEBOX_SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("MOVIEBOX_SERVER_PORT").unwrap_or_else(|_| "9797".to_string());
    let proxy_base = std::env::var("MOVIEBOX_PROXY_BASE").unwrap_or_default();

    let svc = Arc::new(MovieBoxService::new());
    let proxy_client = moviebox_tui::net::http_client_builder()
        .timeout(Duration::from_secs(6 * 3600))
        .build()
        .unwrap_or_default();

    let transcode_cfg = Arc::new(TranscodeConfig::from_env());
    let transcodes = Arc::new(TranscodeStore::default());
    if transcode_cfg.enabled {
        if let Err(e) = tokio::fs::create_dir_all(&transcode_cfg.base_dir).await {
            log::warn!(
                "transcode base dir {} unavailable: {e}",
                transcode_cfg.base_dir.display()
            );
        }
        log::info!(
            "transcode gateway enabled: base={}, ffmpeg={}, preset={}, crf={}",
            transcode_cfg.base_dir.display(),
            transcode_cfg.ffmpeg_path,
            transcode_cfg.preset,
            transcode_cfg.crf
        );
    } else {
        log::info!("transcode gateway disabled (TRANSCODE_ENABLED != 1)");
    }

    let state = AppState {
        svc,
        tickets: Arc::new(TicketStore::default()),
        proxy_client,
        proxy_base,
        transcodes,
        transcode_cfg,
    };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/home", get(home))
        .route("/api/search", get(search))
        .route("/api/search/unified", get(search_unified))
        .route("/api/anime/seasonal", get(anime_seasonal))
        .route("/api/anime/trending", get(anime_trending))
        .route("/api/anime/popular", get(anime_popular))
        .route("/api/anime/recent", get(anime_recent))
        .route("/api/suggest", get(suggest))
        .route("/api/details", get(details))
        .route("/api/streams", get(streams))
        .route("/api/captions", get(captions))
        .route("/api/play", post(play))
        .route("/api/proxy/ticket", post(create_ticket))
        .route("/api/proxy/{ticket}", get(proxy_fetch_root))
        .route("/api/proxy/{ticket}/{*rest}", get(proxy_fetch))
        .route("/api/transcode/start", post(transcode_start))
        .route(
            "/api/transcode/{session}/state",
            get(transcode_state),
        )
        .route(
            "/api/transcode/{session}/seek",
            post(transcode_seek),
        )
        .route(
            "/api/transcode/{session}/{*rest}",
            get(transcode_file),
        )
        .route("/api/transcode/{session}", delete(transcode_delete))
        .route("/api/config", get(get_config))
        .route("/api/local-history", get(local_history))
        .route("/api/local-favorites", get(local_favorites))
        .with_state(state);

    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("cannot bind {addr}: {e}"));
    log::info!("moviebox-server listening on http://{addr}");
    axum::serve(listener, app).await.expect("server error");
}
