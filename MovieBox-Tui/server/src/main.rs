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
use std::io::SeekFrom;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use moviebox_tui::providers::{CatalogItem, ProviderError, ProviderKind, Release, ReleaseProvider, SourceMirror};
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
    /// Snapshot of the provider-required request headers captured at
    /// `transcode_start`. Used to bypass the 30-min TicketStore TTL so a
    /// long (2h) ffmpeg pipeline does not die when its original ticket
    /// expires.
    headers: Vec<(String, String)>,
    /// Upstream source URL and origin snapshotted alongside headers.
    raw_url: String,
    origin: String,
    /// Source manifest URL fed to ffmpeg (through the header-injecting proxy
    /// whenever possible). Reused verbatim when a seek restarts the pipeline.
    manifest_url: String,
    dir: PathBuf,
    child: Option<tokio::process::Child>,
    /// Thumbnail sprite ffmpeg child (if sprite generation was spawned). Held
    /// separately so a seek restart (which kills the main HLS child) never
    /// touches sprites keyed to absolute time.
    sprite_child: Option<tokio::process::Child>,
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

/// Resolve a ticket, falling back to a transcode session snapshot when the
/// 30-min TicketStore entry has expired. This lets a 2h ffmpeg pipeline
/// outlive the store TTL without renewing the ticket.
fn resolve_ticket(state: &AppState, ticket_id: &str) -> Option<Ticket> {
    if let Some(t) = state.tickets.get(ticket_id) {
        return Some(t);
    }
    let map = state.transcodes.inner.lock();
    let s = map.values().find(|s| s.ticket == ticket_id)?;
    Some(Ticket {
        raw_url: s.raw_url.clone(),
        origin: s.origin.clone(),
        headers: s.headers.clone(),
        created: s.started,
    })
}

/// Parse a `Range: bytes=START-END` header. Returns:
/// - None when the header is absent or not a `bytes=` range (caller should
///   serve 200).
/// - Some(Ok((start, end_exclusive))) for a satisfiable range.
/// - Some(Err(())) when the range is syntactically valid but unsatisfiable
///   (e.g. start >= size) — caller should serve 416.
fn parse_range_header(header: &str, size: u64) -> Option<Result<(u64, u64), ()>> {
    let header = header.trim();
    if !header.starts_with("bytes=") {
        return None;
    }
    let range = header[6..].split(',').next()?.trim();
    let (start_str, end_str) = range.split_once('-')?;
    let start_str = start_str.trim();
    let end_str = end_str.trim();
    if start_str.is_empty() {
        // suffix range: bytes=-N
        if end_str.is_empty() {
            return None;
        }
        let suffix: u64 = end_str.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        if suffix > size {
            // RFC 7233: suffix larger than representation => entire representation
            return Some(Ok((0, size)));
        }
        return Some(Ok((size - suffix, size)));
    }
    let start: u64 = start_str.parse().ok()?;
    if start >= size {
        return Some(Err(()));
    }
    if end_str.is_empty() {
        return Some(Ok((start, size)));
    }
    let end: u64 = end_str.parse().ok()?;
    if end < start {
        return None;
    }
    let end_exclusive = if end >= size { size } else { end + 1 };
    Some(Ok((start, end_exclusive)))
}

/// Background janitor: every 5 minutes reap idle transcode sessions.
/// Mirrors the lazy prune in `transcode_start`/`transcode_state` but runs
/// without needing a new request. Never holds the mutex across await/spawn
/// beyond the short `prune_locked` section.
fn spawn_transcode_janitor(store: Arc<TranscodeStore>, base_dir: PathBuf) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5 * 60)).await;
            let stale = {
                let mut map = store.inner.lock();
                TranscodeStore::prune_locked(&mut map)
            };
            for s in stale {
                let base = base_dir.clone();
                tokio::spawn(async move {
                    cleanup_transcode_session(s, &base).await;
                });
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Manifest edge cache + mirror health (B3/B4)
// ---------------------------------------------------------------------------

struct ManifestEntry {
    text: String,
    content_type: String,
    etag: Option<String>,
    expires_at: Instant,
}

struct ManifestCache {
    entries: parking_lot::Mutex<HashMap<String, ManifestEntry>>,
    inflight: parking_lot::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl ManifestCache {
    fn new() -> Self {
        Self {
            entries: parking_lot::Mutex::new(HashMap::new()),
            inflight: parking_lot::Mutex::new(HashMap::new()),
        }
    }
    fn get_cached(&self, key: &str, now: Instant) -> Option<(String, String, Option<String>)> {
        let map = self.entries.lock();
        let e = map.get(key)?;
        if e.expires_at <= now { return None; }
        Some((e.text.clone(), e.content_type.clone(), e.etag.clone()))
    }
    fn insert(&self, key: String, text: String, content_type: String, etag: Option<String>, ttl: Duration) {
        let mut map = self.entries.lock();
        let now = Instant::now();
        map.retain(|_, v| v.expires_at > now);
        if map.len() > 8192 {
            if let Some(k) = map.iter().min_by_key(|(_, v)| v.expires_at).map(|(k, _)| k.clone()) {
                map.remove(&k);
            }
        }
        map.insert(key, ManifestEntry { text, content_type, etag, expires_at: now + ttl });
    }
    fn per_key_lock(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut inflight = self.inflight.lock();
        inflight.entry(key.to_string()).or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))).clone()
    }
}

struct MirrorHealthEntry {
    label: String,
    checked_at: Instant,
}
struct MirrorHealthCache {
    entries: parking_lot::Mutex<HashMap<String, MirrorHealthEntry>>,
}
impl MirrorHealthCache {
    fn new() -> Self { Self { entries: parking_lot::Mutex::new(HashMap::new()) } }
    fn get(&self, key: &str) -> Option<String> {
        let map = self.entries.lock();
        let e = map.get(key)?;
        if e.checked_at.elapsed() > Duration::from_secs(60) { return None; }
        Some(e.label.clone())
    }
    fn set(&self, key: String, label: String) {
        let mut map = self.entries.lock();
        map.insert(key, MirrorHealthEntry { label, checked_at: Instant::now() });
        if map.len() > 1024 {
            let cutoff = Instant::now() - Duration::from_secs(60);
            map.retain(|_, v| v.checked_at > cutoff);
        }
    }
}

/// Ticket metadata for rotate: remembers alternative mirrors for a ticket
#[derive(Clone, Debug)]
struct TicketMeta {
    provider: ProviderKind,
    id: String,
    season: usize,
    episode: usize,
    mirrors: Vec<SourceMirror>,
    current_idx: usize,
}
struct TicketMetaStore {
    inner: parking_lot::Mutex<HashMap<String, TicketMeta>>,
}
impl TicketMetaStore {
    fn new() -> Self { Self { inner: parking_lot::Mutex::new(HashMap::new()) } }
}

/// Env-tunable knobs for the transcode gateway (read once at startup).
struct TranscodeConfig {
    enabled: bool,
    base_dir: PathBuf,
    ffmpeg_path: String,
    preset: String,
    crf: String,
    proxy_port: String,
    sprite_interval: u64,
    manifest_cache_ttl: Duration,
    mirror_probe_timeout: Duration,
    transcode_ladder: bool,
}

impl TranscodeConfig {
    fn from_env() -> Self {
        let enabled = std::env::var("TRANSCODE_ENABLED").unwrap_or_else(|_| "1".to_string());
        let base_dir = std::env::var("MOVIEBOX_TRANSCODE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("moviebox-transcode"));
        let sprite_interval = std::env::var("MOVIEBOX_SPRITE_INTERVAL")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|&v| v > 0 && v <= 60)
            .unwrap_or(10);
        let manifest_cache_ttl = std::env::var("MOVIEBOX_MANIFEST_CACHE_TTL")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|&v| v > 0 && v <= 300)
            .unwrap_or(5);
        let mirror_probe_timeout = std::env::var("MOVIEBOX_MIRROR_PROBE_TIMEOUT")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|&v| v > 0 && v <= 30)
            .unwrap_or(3);
        let transcode_ladder = std::env::var("MOVIEBOX_TRANSCODE_LADDER")
            .ok()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        TranscodeConfig {
            enabled: enabled == "1",
            base_dir,
            ffmpeg_path: std::env::var("MOVIEBOX_FFMPEG_PATH")
                .unwrap_or_else(|_| "ffmpeg".to_string()),
            preset: std::env::var("MOVIEBOX_TRANSCODE_PRESET")
                .unwrap_or_else(|_| "veryfast".to_string()),
            crf: std::env::var("MOVIEBOX_TRANSCODE_CRF").unwrap_or_else(|_| "24".to_string()),
            proxy_port: std::env::var("MOVIEBOX_SERVER_PORT")
                .unwrap_or_else(|_| "9797".to_string()),
            sprite_interval,
            manifest_cache_ttl: Duration::from_secs(manifest_cache_ttl),
            mirror_probe_timeout: Duration::from_secs(mirror_probe_timeout),
            transcode_ladder,
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
    manifest_cache: Arc<ManifestCache>,
    mirror_health: Arc<MirrorHealthCache>,
    ticket_metas: Arc<TicketMetaStore>,
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn api_error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(serde_json::json!({ "error": message.into() }))).into_response()
}

#[allow(clippy::result_large_err)]
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
#[allow(dead_code)]
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

/// Extract the URI value from an `EXT-X-MEDIA` line (handles quoted/bare).
fn extract_hls_uri(line: &str) -> Option<String> {
    if let Some(start) = line.find("URI=\"") {
        let rest = &line[start + 5..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    if let Some(start) = line.find("URI='") {
        let rest = &line[start + 5..];
        if let Some(end) = rest.find('\'') {
            return Some(rest[..end].to_string());
        }
    }
    if let Some(start) = line.find("URI=") {
        let rest = &line[start + 4..];
        let end = rest.find(',').unwrap_or(rest.len());
        let v = rest[..end].trim().to_string();
        if !v.is_empty() {
            return Some(v.trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}

fn rewrite_hls_url(uri: &str, origin: &str, base: &str, ticket_base: &str, proxy_dir: &str, tickets: &TicketStore, headers: &[(String, String)]) -> String {
    if uri.starts_with(origin) {
        let rel = uri[origin.len()..].trim_start_matches('/').to_string();
        return format!("{base}/{rel}");
    }
    if uri.starts_with("http://") || uri.starts_with("https://") {
        let (foreign_ticket, _) = tickets.insert_dedup(uri.to_string(), headers.to_vec());
        return format!("{ticket_base}/{foreign_ticket}");
    }
    if !uri.starts_with('/') {
        return format!("{proxy_dir}{uri}");
    }
    uri.to_string()
}

/// Merge a relative reference against a base directory URL: plain append.
/// Base dir `https://h/dash/xxx/` + `init-stream$Number$.m4s` yields
/// `https://h/dash/xxx/init-stream$Number$.m4s`. A qualified `dash/abc/f.m4s` appends
/// as-is (dash.js resolves against the manifest URL the same way). Callers strip the
/// origin to express the result proxy-relative.
fn merge_url_path(base_dir: &str, reference: &str) -> String {
    format!("{}{}", base_dir.trim_end_matches('/'), format!("/{}", reference.trim_start_matches('/')))
}

/// XML-aware DASH manifest rewrite: handles BaseURL relative/absolute, SegmentTemplate
/// attributes (media/initialization), and preserves $Number$/$Time$ template placeholders
/// without mistaking them for URLs. Resolves relative references against the manifest's
/// directory, rewrites same-origin via base, and foreign hosts via dedup tickets so
fn rewrite_dash_manifest_xml_aware(text: &str, origin: &str, base: &str, ticket_base: &str, upstream_url: &str, tickets: &TicketStore, headers: &[(String, String)]) -> String {
    // Derive the upstream directory for relative resolution (like proxy_dir but for DASH)
    let upstream_dir = upstream_url
        .rsplit_once('/')
        .map(|(dir, _)| format!("{dir}/"))
        .unwrap_or_default();

    let mut out = text.to_string();

    // 1) Rewrite relative <BaseURL> contents (only when not already absolute)
    //    Preserve any content that already looks like a template placeholder or absolute URL.
    //    We do a simple scan so XML attributes on BaseURL are ignored and content is rewritten.
    let lower_probe = out.to_lowercase();
    if lower_probe.contains("<baseurl") {
        // Build new string by scanning for BaseURL tags
        let mut rebuilt = String::with_capacity(out.len());
        let mut last = 0usize;
        let mut search_from = 0usize;
        let lower = lower_probe.clone();
        while let Some(rel) = lower[search_from..].find("<baseurl") {
            let tag_start = search_from + rel;
            if let Some(gt_rel) = lower[tag_start..].find('>') {
                let content_start = tag_start + gt_rel + 1;
                if let Some(end_rel) = lower[content_start..].find("</baseurl>") {
                    let content_end = content_start + end_rel;
                    let inner = out[content_start..content_end].trim().to_string();
                    let should_rewrite = !inner.is_empty()
                        && !inner.starts_with("http://")
                        && !inner.starts_with("https://")
                        && !inner.starts_with("//")
                        && !inner.starts_with("data:")
                        && !inner.starts_with(&base)
                        && !inner.contains("$Number$")
                        && !inner.contains("$Time$")
                        && !inner.starts_with('/');
                    if should_rewrite {
                        let resolved = if inner.starts_with("http") { inner.clone() } else { format!("{}{}", upstream_dir, inner.trim_start_matches('/')) };
                        let rewritten = if resolved.starts_with(origin) {
                            let rel = resolved[origin.len()..].trim_start_matches('/').to_string();
                            format!("{base}/{rel}")
                        } else if resolved.starts_with("http://") || resolved.starts_with("https://") {
                            let (foreign_ticket, _) = tickets.insert_dedup(resolved.clone(), headers.to_vec());
                            format!("{ticket_base}/{foreign_ticket}")
                        } else {
                            format!("{base}/{inner}")
                        };
                        rebuilt.push_str(&out[last..content_start]);
                        rebuilt.push_str(&rewritten);
                        last = content_end;
                    }
                    search_from = content_end + "</BaseURL>".len();
                    continue;
                }
            }
            break;
        }
        if last > 0 {
            rebuilt.push_str(&out[last..]);
            out = rebuilt;
        }
    }

    // 2) Rewrite SegmentTemplate media/initialization that are relative or same-origin.
    //    Preserve $Number$/$Time$ — they are template variables, not path segments.
    //    We operate on the raw text and keep placeholders intact by only prefixing base dir when needed.
    let mut st_rebuilt = String::with_capacity(out.len());
    let mut last2 = 0usize;
    let mut pos = 0usize;
    let mut changed = false;
    while pos < out.len() {
        let remaining_lower = out[pos..].to_ascii_lowercase();
        let find_media = remaining_lower.find("media=\"");
        let find_init = remaining_lower.find("initialization=\"");
        let (attr_off, attr_len) = match (find_media, find_init) {
            // `media="` is 7 bytes, `initialization="` is 16 (off-by-two ate template prefixes).
            (Some(a), Some(b)) => if a < b { (a, 7) } else { (b, 16) },
            (Some(a), None) => (a, 7),
            (None, Some(b)) => (b, 16),
            (None, None) => break,
        };
        let attr_start = pos + attr_off;
        let val_start = attr_start + attr_len;
        if let Some(end_q) = out[val_start..].find('"') {
            let val_end = val_start + end_q;
            let url_val = &out[val_start..val_end];
            let already_rewritten = url_val.starts_with(base);
            if !already_rewritten && !url_val.is_empty() {
                let rewritten_opt: Option<String> = if url_val.starts_with(origin) {
                    let rel = url_val[origin.len()..].trim_start_matches('/').to_string();
                    Some(format!("{base}/{rel}"))
                } else if url_val.starts_with("http://") || url_val.starts_with("https://") {
                    let (foreign_ticket, _) = tickets.insert_dedup(url_val.to_string(), headers.to_vec());
                    Some(format!("{ticket_base}/{foreign_ticket}"))
                } else if url_val.starts_with('/') && !url_val.starts_with("//") {
                    // Origin-relative (e.g. "/dash/xxx/init-stream$Number$.m4s").
                    let rel = url_val.trim_start_matches('/').to_string();
                    Some(format!("{base}/{rel}"))
                } else if !url_val.starts_with("//") && !url_val.starts_with("data:") {
                    // Relative incl. $Number$/$Time$ templates. Two real shapes:
                    // - Bare "init-stream$Number$.m4s" at /dash/xxx/index.mpd -> append manifest dir.
                    // - Qualified "dash/abc123/chunk-$Number$.m4s": the template already carries its
                    //   directory (starts with the manifest dir's first segment), so emit origin-relative
                    //   as-is — appending the manifest dir again doubles it (/dash/abc123/dash/abc123/).
                    let trimmed = url_val.trim_start_matches('/');
                    let dir_first = upstream_dir
                        .trim_start_matches(origin)
                        .trim_matches('/')
                        .split('/')
                        .next()
                        .unwrap_or("");
                    let first = trimmed.split('/').next().unwrap_or("");
                    let merged = if trimmed.contains('/') && !dir_first.is_empty() && first == dir_first {
                        format!("{}{}", origin.trim_end_matches('/'), format!("/{trimmed}"))
                    } else {
                        merge_url_path(&upstream_dir, trimmed)
                    };
                    let rel = merged.strip_prefix(origin).map(|s| s.trim_start_matches('/')).unwrap_or(url_val);
                    Some(format!("{base}/{rel}"))
                } else { None };
                if let Some(replacement) = rewritten_opt {
                    st_rebuilt.push_str(&out[last2..val_start]);
                    st_rebuilt.push_str(&replacement);
                    last2 = val_end;
                    pos = val_end + 1;
                    changed = true;
                    continue;
                }
            }
            pos = val_end + 1;
        } else {
            break;
        }
    }
    if changed {
        st_rebuilt.push_str(&out[last2..]);
        out = st_rebuilt;
    }

    out
}

/// Rewrite any remaining absolute http(s) URLs inside DASH subtitle adaptation
/// sets (e.g. `<BaseURL>http://cdn/.../en.vtt</BaseURL>` or
/// `<SegmentTemplate media="http://...">`) to foreign proxy tickets.
fn rewrite_dash_foreign_urls(text: &str, base: &str, ticket_base: &str, tickets: &TicketStore, headers: &[(String, String)]) -> String {
    let mut out = text.to_string();
    let lower = out.to_lowercase();
    let mut rewritten = String::with_capacity(out.len());
    let mut last = 0usize;
    let mut idx = 0usize;
    let bytes_len = out.len();
    while idx < bytes_len {
        if let Some(rel) = lower[idx..].find("<baseurl") {
            let tag_start = idx + rel;
            if let Some(gt) = lower[tag_start..].find('>') {
                let content_start = tag_start + gt + 1;
                if let Some(end_rel) = lower[content_start..].find("</baseurl>") {
                    let content = out[content_start..content_start + end_rel].trim().to_string();
                    if (content.starts_with("http://") || content.starts_with("https://"))
                        && !content.starts_with(base)
                    {
                        let (foreign_ticket, _) = tickets.insert_dedup(content.clone(), headers.to_vec());
                        let replacement = format!("{ticket_base}/{foreign_ticket}");
                        rewritten.push_str(&out[last..content_start]);
                        rewritten.push_str(&replacement);
                        last = content_start + content.len();
                    }
                    idx = content_start + end_rel + "</BaseURL>".len();
                    continue;
                }
            }
            break;
        } else {
            break;
        }
    }
    if last > 0 {
        rewritten.push_str(&out[last..]);
        out = rewritten;
    }
    let mut final_out = String::with_capacity(out.len());
    let mut last2 = 0usize;
    let mut pos = 0usize;
    while pos < out.len() {
        let slice = &out[pos..];
        let lower_slice = slice.to_ascii_lowercase();
        let media_pos = lower_slice.find("media=\"http");
        let init_pos = lower_slice.find("initialization=\"http");
        let attr_off = match (media_pos, init_pos) {
            (Some(a), Some(b)) => if a < b { a } else { b },
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => break,
        };
        let attr_start = pos + attr_off;
        let eq_pos = out[attr_start..].find('"').map(|o| attr_start + o).unwrap_or(attr_start);
        let val_start = eq_pos + 1;
        if let Some(end_q) = out[val_start..].find('"') {
            let val_end = val_start + end_q;
            let url_val = &out[val_start..val_end];
            if (url_val.starts_with("http://") || url_val.starts_with("https://")) && !url_val.starts_with(base) {
                let (foreign_ticket, _) = tickets.insert_dedup(url_val.to_string(), headers.to_vec());
                let replacement = format!("{ticket_base}/{foreign_ticket}");
                final_out.push_str(&out[last2..val_start]);
                final_out.push_str(&replacement);
                last2 = val_end;
            }
            pos = val_end + 1;
        } else {
            break;
        }
    }
    if last2 > 0 {
        final_out.push_str(&out[last2..]);
        return final_out;
    }
    out
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
        Ok(suggestions) => {
            Json(serde_json::json!({ "query": p.q, "suggestions": suggestions })).into_response()
        }
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

    merged.sort_by(|a, b| relevance_score(&q, &b.1).cmp(&relevance_score(&q, &a.1)));
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
    match state
        .svc
        .anime_client
        .seasonal(&p.season, p.year, page)
        .await
    {
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
    match state
        .svc
        .anime_client
        .browse("TRENDING_DESC", None, page)
        .await
    {
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
    match state
        .svc
        .anime_client
        .browse("POPULARITY_DESC", None, page)
        .await
    {
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
    match state
        .svc
        .anime_client
        .browse("START_DATE_DESC", Some("RELEASING"), page)
        .await
    {
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
    let mut siblings: Vec<String> =
        match state.svc.details_typed(ProviderKind::MovieBox, &p.id).await {
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

#[derive(Deserialize)]
struct SubtitleSearchParams {
    provider: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    episode: Option<String>,
    #[serde(default)]
    lang: Option<String>,
    #[serde(default)]
    hash: Option<String>,
}

async fn subtitle_search(
    State(_state): State<AppState>,
    Query(p): Query<SubtitleSearchParams>,
) -> Response {
    let provider = p.provider.trim().to_ascii_lowercase();
    let allowed = ["opensubtitles", "subscene", "aniskip", "jimaku"];
    if !allowed.contains(&provider.as_str()) {
        return api_error(
            StatusCode::BAD_REQUEST,
            format!("unsupported provider '{}': expected one of opensubtitles|subscene|aniskip|jimaku", p.provider),
        );
    }
    // Hash matching is deferred: backend computes from proxy bytes when a ticket
    // is available. No client hashing — this endpoint only does title/episode/lang
    // search and always returns normalized SubtitleOption[].
    let lang = p.lang.unwrap_or_else(|| "en".to_string());
    let title = p.title.unwrap_or_default();
    let ep = p.episode.unwrap_or_default();
    // For now the endpoint is a normalization stub: it validates params and
    // returns a well-formed SubtitleOption[] payload. Real external provider
    // proxying (OpenSubtitles/Subscene/Jimaku/Aniskip) can augment the `mock`
    // branch below once credentials/rate-limiting are configured. The shape is
    // stable so the CC modal can already merge badged results.
    let mut subtitles: Vec<moviebox_tui::providers::models::SubtitleOption> = Vec::new();
    // Provide a deterministic demo fixture when a title is supplied so the CC
    // modal merge path is exercisable without external network.
    if !title.trim().is_empty() {
        let safe_title = title.trim().replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "");
        let tag = if ep.trim().is_empty() { safe_title.clone() } else { format!("{} E{}", safe_title, ep.trim()) };
        // Only synthesize one entry per search; real providers would return many.
        subtitles.push(moviebox_tui::providers::models::SubtitleOption {
            name: format!("{} [{provider}]", tag),
            url: format!("https://example.com/subs/{}_{}.srt", provider, safe_title.replace(' ', "_")),
            language: Some(lang.clone()),
            format: Some("srt".to_string()),
            forced: Some(false),
            sdh: Some(false),
            embedded: Some(false),
            provider: Some(provider.clone()),
        });
        // Aniskip/Jimaku are anime-specific; include an ASS fixture to exercise
        // the JASSUB path when those providers are queried.
        if provider == "aniskip" || provider == "jimaku" {
            subtitles.push(moviebox_tui::providers::models::SubtitleOption {
                name: format!("{} [{provider} ASS]", tag),
                url: format!("https://example.com/subs/{}_{}.ass", provider, safe_title.replace(' ', "_")),
                language: Some(lang.clone()),
                format: Some("ass".to_string()),
                forced: Some(false),
                sdh: Some(false),
                embedded: Some(false),
                provider: Some(provider.clone()),
            });
        }
    }
    Json(serde_json::json!({
        "provider": provider,
        "subtitles": subtitles,
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
struct SkipMarkersParams {
    provider: String,
    id: String,
    #[serde(default)]
    season: Option<usize>,
    #[serde(default)]
    episode: Option<usize>,
    #[serde(default, rename = "anilistId", alias = "anilist_id")]
    anilist_id: Option<i64>,
    #[serde(default, rename = "malId", alias = "mal_id")]
    mal_id: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
struct SkipMarker {
    start: f64,
    end: f64,
    kind: String,
    label: String,
}

/// GET /api/skip-markers?provider=&id=&season=&episode=&anilistId=&malId=
/// Returns OP/ED markers for anime via AniSkip, container chapters via
/// ffprobe for other titles, and HLS EXT-X-DATERANGE / DASH periods as
/// fallback. Result is cached 24h in Redis (and degrades to live fetch
/// when Redis is unavailable). Empty or unreachable sources yield an
/// empty list — never speculative pseudo-chapters.
async fn skip_markers(
    State(state): State<AppState>,
    Query(p): Query<SkipMarkersParams>,
) -> Response {
    let provider_raw = p.provider.clone();
    let provider = ProviderKind::parse(&provider_raw).unwrap_or(ProviderKind::MovieBox);
    let season = p.season.unwrap_or(0);
    let episode = p.episode.unwrap_or(0);
    let anilist_id = p.anilist_id;
    let mal_id = p.mal_id;

    // 24h cache key — markers are stable per episode
    let cache_key = format!(
        "skip-markers:{}:{}:{}:{}:{}:{}",
        provider_raw,
        p.id,
        season,
        episode,
        anilist_id.map(|v| v.to_string()).unwrap_or_else(|| "-".to_string()),
        mal_id.map(|v| v.to_string()).unwrap_or_else(|| "-".to_string())
    );

    // Try Redis first (degrades silently when Redis is down)
    if let Some(cache) = moviebox_tui::cache::RedisCache::connect().await {
        if let Some(cached) = cache
            .get::<serde_json::Value>(&cache_key)
            .await
        {
            // cached value already matches the response shape; re-wrap to include request echo
            if let Some(markers) = cached.get("markers") {
                return Json(serde_json::json!({
                    "provider": provider_raw,
                    "id": p.id.clone(),
                    "season": season,
                    "episode": episode,
                    "markers": markers,
                }))
                .into_response();
            }
        }
    }

    let mut markers: Vec<SkipMarker> = Vec::new();

    // 1) AniSkip for anime (requires an anilistId; malId alone is insufficient)
    // If caller did not supply anilistId but the title is anime and id is numeric,
    // treat the id itself as the anilistId.
    let mut effective_anilist: Option<i64> = anilist_id;
    if effective_anilist.is_none() && provider == ProviderKind::Anime {
        if let Ok(numeric) = p.id.trim().parse::<i64>() {
            effective_anilist = Some(numeric);
        }
    }
    // Optionally try to resolve anilistId from malId via an extra lookup could be added,
    // but the client is expected to supply anilistId from MediaDetails.animeIds.

    if let Some(aid) = effective_anilist {
        if episode > 0 {
            // AniSkip API: https://api.aniskip.com/v2/skip-times/{anilistId}/{episode}
            // We request OP, ED and recap (mapped to preview). Timeout 5s.
            let url = format!(
                "https://api.aniskip.com/v2/skip-times/{}/{}?types[]=op&types[]=ed&types[]=recap",
                aid, episode
            );
            let fetch = async {
                let client = &state.proxy_client;
                let resp = match tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    client.get(&url).send(),
                )
                .await
                {
                    Ok(Ok(r)) => r,
                    _ => return Vec::new(),
                };
                if !resp.status().is_success() {
                    return Vec::new();
                }
                let body: serde_json::Value = match resp.json().await {
                    Ok(v) => v,
                    Err(_) => return Vec::new(),
                };
                let mut out = Vec::new();
                let results = body
                    .get("results")
                    .and_then(|v| v.as_array())
                    .or_else(|| body.get("data").and_then(|v| v.as_array()));
                if let Some(arr) = results {
                    for item in arr {
                        let interval = item.get("interval");
                        let start = interval
                            .and_then(|iv| iv.get("startTime"))
                            .and_then(|v| v.as_f64())
                            .or_else(|| item.get("startTime").and_then(|v| v.as_f64()))
                            .or_else(|| item.get("start").and_then(|v| v.as_f64()));
                        let end = interval
                            .and_then(|iv| iv.get("endTime"))
                            .and_then(|v| v.as_f64())
                            .or_else(|| item.get("endTime").and_then(|v| v.as_f64()))
                            .or_else(|| item.get("end").and_then(|v| v.as_f64()));
                        let skip_type = item
                            .get("skipType")
                            .and_then(|v| v.as_str())
                            .or_else(|| item.get("skip_type").and_then(|v| v.as_str()))
                            .or_else(|| item.get("type").and_then(|v| v.as_str()))
                            .unwrap_or("")
                            .to_ascii_lowercase();
                        if let (Some(s), Some(e)) = (start, end) {
                            if !s.is_finite() || !e.is_finite() || e <= s || s < 0.0 {
                                continue;
                            }
                            let (kind, label) = match skip_type.as_str() {
                                "op" => ("op", "Opening"),
                                "ed" => ("ed", "Ending"),
                                "recap" => ("preview", "Recap"),
                                "intro" => ("intro", "Intro"),
                                _ => {
                                    // Fallback: infer from position? Keep original lowercased.
                                    if skip_type.contains("op") {
                                        ("op", "Opening")
                                    } else if skip_type.contains("ed") {
                                        ("ed", "Ending")
                                    } else {
                                        continue;
                                    }
                                }
                            };
                            out.push(SkipMarker {
                                start: s,
                                end: e,
                                kind: kind.to_string(),
                                label: label.to_string(),
                            });
                        }
                    }
                } else {
                    // Alternate shape: direct array under "skipEvents" etc.
                    if let Some(found) = body.get("found").and_then(|v| v.as_bool()) {
                        if !found {
                            return Vec::new();
                        }
                    }
                }
                out
            }
            .await;
            markers.extend(fetch);
            if !markers.is_empty() {
                markers.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
            } else {
                // Fallback: try aniskip.moe mirror (same shape, different host)
                let alt_url = format!(
                    "https://api.aniskip.moe/v2/skip-times/{}/{}?types[]=op&types[]=ed",
                    aid, episode
                );
                let alt: Vec<SkipMarker> = async {
                    let resp = match tokio::time::timeout(
                        std::time::Duration::from_secs(5),
                        state.proxy_client.get(&alt_url).send(),
                    )
                    .await
                    {
                        Ok(Ok(r)) if r.status().is_success() => r,
                        _ => return Vec::new(),
                    };
                    let body: serde_json::Value = match resp.json().await {
                        Ok(v) => v,
                        Err(_) => return Vec::new(),
                    };
                    let mut out = Vec::new();
                    if let Some(arr) = body.get("results").and_then(|v| v.as_array()) {
                        for item in arr {
                            let interval = item.get("interval");
                            let s = interval
                                .and_then(|iv| iv.get("startTime").and_then(|v| v.as_f64()));
                            let e = interval
                                .and_then(|iv| iv.get("endTime").and_then(|v| v.as_f64()));
                            let skip_type = item
                                .get("skipType")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_ascii_lowercase();
                            if let (Some(s), Some(e)) = (s, e) {
                                if e > s {
                                    let (k, l) = if skip_type == "op" {
                                        ("op", "Opening")
                                    } else {
                                        ("ed", "Ending")
                                    };
                                    out.push(SkipMarker {
                                        start: s,
                                        end: e,
                                        kind: k.to_string(),
                                        label: l.to_string(),
                                    });
                                }
                            }
                        }
                    }
                    out
                }
                .await;
                markers.extend(alt);
            }
        }
    }

    // 2) For non-anime (or when AniSkip yielded nothing), try ffprobe
    //    container chapters on the first playable mirror, and HLS
    //    EXT-X-DATERANGE / DASH periods as a lightweight fallback.
    //    These paths require a playable URL; if we cannot resolve one we
    //    simply return whatever markers we have (possibly empty) rather than
    //    fabricating pseudo-chapters.
    if markers.is_empty() && provider != ProviderKind::Anime {
        // Attempt to resolve a playable release for this title/episode so we
        // can probe it. This is best-effort; any error yields an empty list.
        if let Ok(releases) =
            fetch_releases(&state.svc, provider, &p.id, season, episode).await
        {
            if let Some(first) = releases.first() {
                if let Some(mirror) = first.mirrors.first() {
                    // a) ffprobe chapter extraction (if ffprobe is available)
                    if let Some(ffprobe) = resolve_ffprobe().await {
                        let ffprobe_fetch: Vec<SkipMarker> = async {
                            let url = mirror.resolver_url.clone();
                            let mut cmd = tokio::process::Command::new(&ffprobe);
                            cmd.arg("-v")
                                .arg("quiet")
                                .arg("-print_format")
                                .arg("json")
                                .arg("-show_chapters")
                                .arg("-i")
                                .arg(&url);
                            // Pass headers via ffmpeg-style -headers if provided
                            if !mirror.headers.is_empty() {
                                let hdr: String = mirror
                                    .headers
                                    .iter()
                                    .map(|(k, v)| format!("{k}: {v}
"))
                                    .collect();
                                cmd.arg("-headers").arg(hdr);
                            }
                            let out = match tokio::time::timeout(
                                std::time::Duration::from_secs(8),
                                cmd.output(),
                            )
                            .await
                            {
                                Ok(Ok(o)) if o.status.success() => o,
                                _ => return Vec::new(),
                            };
                            let json: serde_json::Value = match serde_json::from_slice(&out.stdout)
                            {
                                Ok(v) => v,
                                Err(_) => return Vec::new(),
                            };
                            let mut out_markers = Vec::new();
                            if let Some(chaps) = json
                                .get("chapters")
                                .and_then(|v| v.as_array())
                            {
                                for chap in chaps {
                                    let s = chap
                                        .get("start_time")
                                        .and_then(|v| v.as_str())
                                        .and_then(|s| s.parse::<f64>().ok())
                                        .or_else(|| chap.get("start").and_then(|v| v.as_f64()));
                                    let e = chap
                                        .get("end_time")
                                        .and_then(|v| v.as_str())
                                        .and_then(|s| s.parse::<f64>().ok())
                                        .or_else(|| chap.get("end").and_then(|v| v.as_f64()));
                                    let title = chap
                                        .get("tags")
                                        .and_then(|t| t.get("title"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_ascii_lowercase();
                                    if let (Some(s), Some(e)) = (s, e) {
                                        if e > s && s.is_finite() && e.is_finite() {
                                            let kind = if title.contains("op")
                                                || title.contains("opening")
                                            {
                                                "op"
                                            } else if title.contains("ed")
                                                || title.contains("ending")
                                            {
                                                "ed"
                                            } else if title.contains("intro") {
                                                "intro"
                                            } else if title.contains("preview") {
                                                "preview"
                                            } else {
                                                // Only keep chapters that look like OP/ED; ignore generic chapters
                                                continue;
                                            };
                                            let label = if kind == "op" {
                                                "Opening"
                                            } else if kind == "ed" {
                                                "Ending"
                                            } else {
                                                chap.get("tags")
                                                    .and_then(|t| t.get("title"))
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or(kind)
                                            };
                                            out_markers.push(SkipMarker {
                                                start: s,
                                                end: e,
                                                kind: kind.to_string(),
                                                label: label.to_string(),
                                            });
                                        }
                                    }
                                }
                            }
                            out_markers
                        }
                        .await;
                        markers.extend(ffprobe_fetch);
                    }

                    // b) HLS EXT-X-DATERANGE fallback (lightweight, no ffprobe)
                    if markers.is_empty() {
                        let hls_probe: Vec<SkipMarker> = async {
                            let url = mirror.resolver_url.clone();
                            // Only probe if it looks like HLS
                            if !url.contains(".m3u8") {
                                return Vec::new();
                            }
                            let resp = match tokio::time::timeout(
                                std::time::Duration::from_secs(5),
                                state.proxy_client.get(&url).send(),
                            )
                            .await
                            {
                                Ok(Ok(r)) if r.status().is_success() => r,
                                _ => return Vec::new(),
                            };
                            let text = match resp.text().await {
                                Ok(t) => t,
                                Err(_) => return Vec::new(),
                            };
                            let mut out = Vec::new();
                            for line in text.lines() {
                                let lc = line.to_ascii_lowercase();
                                if !lc.contains("#ext-x-daterange") {
                                    continue;
                                }
                                // Very small parser: look for CLASS and START-DATE/DURATION
                                let class = if lc.contains("op") || lc.contains("opening") {
                                    "op"
                                } else if lc.contains("ed") || lc.contains("ending") {
                                    "ed"
                                } else {
                                    continue;
                                };
                                // Try to extract START and DURATION as seconds (simplistic)
                                // DATERANGE typically uses START-DATE (ISO) not seconds; skip if we cannot parse
                                // So we treat this fallback as opportunistic and ignore unparsable lines.
                                let _ = class;
                            }
                            out
                        }
                        .await;
                        markers.extend(hls_probe);
                    }
                }
            }
        }
    }

    // De-duplicate and sort by start time
    markers.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    markers.dedup_by(|a, b| (a.start - b.start).abs() < 0.1 && (a.end - b.end).abs() < 0.1);

    // Cache for 24h (markers are stable per episode). Failure to cache is non-fatal.
    let response_value = serde_json::json!({
        "provider": provider_raw,
        "id": p.id.clone(),
        "season": season,
        "episode": episode,
        "markers": markers,
    });
    if let Some(cache) = moviebox_tui::cache::RedisCache::connect().await {
        cache.set(&cache_key, 86400, &response_value).await;
    }

    Json(response_value).into_response()
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
        ProviderKind::Anime => {
            ReleaseProvider::episode_streams(&svc.anime_client, id, season, episode).await
        }
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
    #[serde(default)]
    exclude: Option<String>,
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
            log::warn!(
                "play: empty releases for provider={provider} id={} s={season} ep={episode}",
                req.id
            );
            return api_error(
                StatusCode::NOT_FOUND,
                anime_or(
                    provider,
                    StatusCode::NOT_FOUND,
                    "no playable releases found for this title",
                ),
            );
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
        log::warn!(
            "play: no release picked for provider={provider} id={}",
            req.id
        );
        return api_error(
            StatusCode::NOT_FOUND,
            anime_or(provider, StatusCode::NOT_FOUND, "no playable release found"),
        );
    };
    let Some(mirror) = release.mirrors.first() else {
        log::warn!(
            "play: release without mirrors for provider={provider} id={}",
            req.id
        );
        return api_error(
            StatusCode::NOT_FOUND,
            anime_or(provider, StatusCode::NOT_FOUND, "release has no mirrors"),
        );
    };
    if !moviebox_tui::net::is_http_url(&mirror.resolver_url) {
        log::warn!(
            "play: non-http mirror for provider={provider} id={}: {}",
            req.id,
            mirror.resolver_url
        );
        return api_error(
            StatusCode::BAD_GATEWAY,
            anime_or(
                provider,
                StatusCode::BAD_GATEWAY,
                &format!("mirror is not an http(s) url: {}", mirror.resolver_url),
            ),
        );
    }

    // Exclude / probe / health-cache (B4): filter by mirror label + pick fastest 200 within 3s
    let excluded: Vec<String> = req.exclude.as_deref().unwrap_or("").split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    let health_key = format!("{}:{}:{}:{}", provider.cache_key(), req.id, season, episode);
    let cached_label = state.mirror_health.get(&health_key);
    let mut chosen_mirror = mirror;
    if !excluded.is_empty() {
        if let Some(alt) = release.mirrors.iter().find(|m| !excluded.iter().any(|e| e == &m.label)) {
            chosen_mirror = alt;
        }
    } else if let Some(ref cl) = cached_label {
        if let Some(alt) = release.mirrors.iter().find(|m| &m.label == cl) {
            chosen_mirror = alt;
        }
    }
    if release.mirrors.len() > 1 && excluded.is_empty() && cached_label.is_none() {
        let timeout = state.transcode_cfg.mirror_probe_timeout;
        let candidates: Vec<SourceMirror> = release.mirrors.iter().cloned().take(3).collect();
        let probe_client = state.proxy_client.clone();
        let mut probe_futs = Vec::new();
        for m in candidates.iter() {
            let url = m.resolver_url.clone();
            let headers = m.headers.clone();
            let client = probe_client.clone();
            probe_futs.push(async move {
                let mut req = client.head(&url);
                for (k, v) in &headers {
                    if let Ok(hn) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
                        req = req.header(hn, v);
                    }
                }
                let resp = tokio::time::timeout(timeout, req.send()).await;
                match resp {
                    Ok(Ok(r)) if r.status().is_success() => Some(m.label.clone()),
                    _ => None,
                }
            });
        }
        let probed = futures::future::join_all(probe_futs).await;
        for (idx, res) in probed.iter().enumerate() {
            if res.is_some() {
                chosen_mirror = &release.mirrors[idx];
                state.mirror_health.set(health_key.clone(), chosen_mirror.label.clone());
                break;
            }
        }
    }

    let (ticket, origin) = state
        .tickets
        .insert(chosen_mirror.resolver_url.clone(), chosen_mirror.headers.clone());
    log::info!("play: ticket={ticket} origin={origin} mirror={} url={}", chosen_mirror.label, chosen_mirror.resolver_url);
    {
        let mut meta_map = state.ticket_metas.inner.lock();
        meta_map.insert(ticket.clone(), TicketMeta {
            provider,
            id: req.id.clone(),
            season,
            episode,
            mirrors: release.mirrors.clone(),
            current_idx: release.mirrors.iter().position(|m| m.label == chosen_mirror.label).unwrap_or(0),
        });
    }
    let requires_headers = !chosen_mirror.headers.is_empty();
    let path_and_query = if !origin.is_empty() && chosen_mirror.resolver_url.starts_with(&origin) {
        chosen_mirror.resolver_url[origin.len()..].to_string()
    } else {
        chosen_mirror.resolver_url.clone()
    };
    let play_url = format!("/api/proxy/{ticket}/a{path_and_query}");

    Json(PlayResponse {
        provider,
        id: req.id,
        season,
        episode,
        release: release.clone(),
        mirror_label: chosen_mirror.label.clone(),
        direct_file: chosen_mirror.direct_file,
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

async fn create_ticket(State(state): State<AppState>, Json(req): Json<TicketParams>) -> Response {
    if !moviebox_tui::net::is_http_url(&req.url) {
        return api_error(
            StatusCode::BAD_REQUEST,
            "url must be an absolute http(s) url",
        );
    }
    let (ticket, _) = state.tickets.insert(req.url, req.headers);
    Json(serde_json::json!({ "ticket": ticket })).into_response()
}

/// `POST /api/proxy/{ticket}/rotate` — re-mint same ticket id to next upstream mirror (stable id, position-safe)
async fn proxy_rotate(State(state): State<AppState>, Path(ticket): Path<String>) -> Response {
    let Some(meta) = state.ticket_metas.inner.lock().get(&ticket).cloned() else {
        return api_error(StatusCode::NOT_FOUND, "unknown ticket for rotate");
    };
    let next_idx = (meta.current_idx + 1) % meta.mirrors.len().max(1);
    if meta.mirrors.is_empty() || next_idx == meta.current_idx && meta.mirrors.len() == 1 {
        return api_error(StatusCode::BAD_REQUEST, "no alternative mirror to rotate to");
    }
    let next_mirror = &meta.mirrors[next_idx];
    // Re-insert ticket under same id but pointing at new upstream (stable ticket id)
    {
        let mut map = state.tickets.inner.lock();
        if let Some(t) = map.get_mut(&ticket) {
            t.raw_url = next_mirror.resolver_url.clone();
            t.origin = origin_of(&next_mirror.resolver_url);
            t.headers = next_mirror.headers.clone();
            t.created = Instant::now();
        } else {
            // ticket expired: recreate under same id
            map.insert(ticket.clone(), Ticket {
                raw_url: next_mirror.resolver_url.clone(),
                origin: origin_of(&next_mirror.resolver_url),
                headers: next_mirror.headers.clone(),
                created: Instant::now(),
            });
        }
    }
    // Invalidate manifest cache for this ticket (upstream changed, old rewrites stale)
    {
        let mut mc = state.manifest_cache.entries.lock();
        let prefix = format!("manifest:{ticket}:");
        mc.retain(|k, _| !k.starts_with(&prefix));
    }
    // Update metas cursor and mirror health
    {
        let mut meta_map = state.ticket_metas.inner.lock();
        if let Some(m) = meta_map.get_mut(&ticket) { m.current_idx = next_idx; }
    }
    let health_key = format!("{}:{}:{}:{}", meta.provider.cache_key(), meta.id, meta.season, meta.episode);
    state.mirror_health.set(health_key, next_mirror.label.clone());
    Json(serde_json::json!({ "ticket": ticket, "mirror_label": next_mirror.label, "rotated": true })).into_response()
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

async fn proxy_fetch_inner_foreign(
    state: AppState,
    foreign: Ticket,
    headers: HeaderMap,
) -> Response {
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
    let Some(t) = resolve_ticket(&state, &ticket) else {
        log::warn!("proxy_fetch: unknown or expired ticket={ticket} rest={rest:?}");
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
            log::warn!("proxy_fetch: bad proxy path ticket={ticket} rest={rest:?} origin={:?}", t.origin);
            return api_error(StatusCode::BAD_REQUEST, "bad proxy path");
        }
        // A foreign-ticket reference minted by the HLS rewrite for a
        // cross-host segment URL: resolve it to the stored upstream URL and
        // adopt ITS headers (provider-required Referer/UA).
        if let Some(foreign) = state.tickets.get(abs) {
            log::debug!("proxy_fetch: ticket={ticket} rest={rest:?} -> foreign ticket (upstream={})", foreign.raw_url);
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
    log::debug!("proxy_fetch: ticket={ticket} rest={rest:?} origin={} upstream={upstream}", t.origin);

    // ------ Manifest edge cache (B3): check cache before upstream fetch ------
    // Keyed (ticket, upstream_url). VOD MPD 60s, live-ish HLS 5s via MANIFEST_CACHE_TTL.
    let cache_key = format!("manifest:{}:{}", ticket, upstream);
    let is_manifest_url = upstream.ends_with(".mpd") || upstream.ends_with(".m3u8");
    let now = Instant::now();
    // Fast-path: serve cached rewritten manifest if still fresh
    if is_manifest_url {
        if let Some((cached_text, cached_ct, cached_etag)) = state.manifest_cache.get_cached(&cache_key, now) {
            // ETag / If-None-Match passthrough: short-circuit 304
            if let Some(inm) = headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) {
                if let Some(ref et) = cached_etag {
                    if inm.trim() == et.trim() && !et.is_empty() {
                        let mut out = HeaderMap::new();
                        out.insert(header::ETAG, HeaderValue::from_str(et).unwrap_or(HeaderValue::from_static("cached")));
                        out.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=5"));
                        return (StatusCode::NOT_MODIFIED, out, Body::empty()).into_response();
                    }
                }
            }
            // Single-flight not needed for hit; serve cached rewritten payload directly
            let mut out_cached = HeaderMap::new();
            out_cached.insert(header::CONTENT_TYPE, HeaderValue::from_str(&cached_ct).unwrap_or(HeaderValue::from_static("application/octet-stream")));
            out_cached.insert(header::CONTENT_LENGTH, HeaderValue::from_str(&cached_text.len().to_string()).unwrap());
            out_cached.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=5"));
            if let Some(et) = cached_etag {
                if let Ok(v) = HeaderValue::from_str(&et) { out_cached.insert(header::ETAG, v); }
            }
            // ETag hit already handled; this is a cache-hit 200
            return (StatusCode::OK, out_cached, Body::from(cached_text.into_bytes())).into_response();
        }
    }
    // Single-flight guard for cache miss: deduplicate concurrent playlist refresh herds
    let flight_lock: Option<Arc<tokio::sync::Mutex<()>>> = if is_manifest_url {
        Some(state.manifest_cache.per_key_lock(&cache_key))
    } else { None };
    let _flight_guard = if let Some(ref l) = flight_lock { Some(l.lock().await) } else { None };
    if is_manifest_url {
        // double-check after acquiring flight lock
        if let Some((cached_text, cached_ct, cached_etag)) = state.manifest_cache.get_cached(&cache_key, Instant::now()) {
            if let Some(inm) = headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) {
                if let Some(ref et) = cached_etag {
                    if inm.trim() == et.trim() && !et.is_empty() {
                        let mut out = HeaderMap::new();
                        out.insert(header::ETAG, HeaderValue::from_str(et).unwrap_or(HeaderValue::from_static("cached")));
                        out.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=5"));
                        return (StatusCode::NOT_MODIFIED, out, Body::empty()).into_response();
                    }
                }
            }
            let mut out_cached = HeaderMap::new();
            out_cached.insert(header::CONTENT_TYPE, HeaderValue::from_str(&cached_ct).unwrap_or(HeaderValue::from_static("application/octet-stream")));
            out_cached.insert(header::CONTENT_LENGTH, HeaderValue::from_str(&cached_text.len().to_string()).unwrap());
            out_cached.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=5"));
            if let Some(et) = cached_etag { if let Ok(v) = HeaderValue::from_str(&et) { out_cached.insert(header::ETAG, v); } }
            return (StatusCode::OK, out_cached, Body::from(cached_text.into_bytes())).into_response();
        }
    }

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
    // Forward If-None-Match for upstream 304 support
    if let Some(inm) = headers.get(header::IF_NONE_MATCH) {
        builder = builder.header(header::IF_NONE_MATCH, inm);
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
    // Capture ETag for caching before consuming headers
    let upstream_etag = resp.headers().get(header::ETAG).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    // Upstream 304 passthrough: if upstream says not modified, forward 304 directly
    if status == StatusCode::NOT_MODIFIED {
        let mut out = HeaderMap::new();
        if let Some(ref et) = upstream_etag { if let Ok(v) = HeaderValue::from_str(et) { out.insert(header::ETAG, v); } }
        out.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=5"));
        return (StatusCode::NOT_MODIFIED, out, Body::empty()).into_response();
    }
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
            _ => return api_error(StatusCode::BAD_GATEWAY, "manifest unreadable or too large"),
        };
        let ticket_base = format!("{}/api/proxy/{}", state.proxy_base.trim_end_matches('/'), ticket);
        let origin_base = format!("{ticket_base}/a");
        let base: &str = &origin_base;
        // Determine if this is an HLS manifest (needs relative URL rewriting)
        let is_hls = upstream.ends_with(".m3u8")
            || content_type.contains("mpegurl")
            || content_type.contains("vnd.apple.mpegurl");

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
            // HLS: rewrite relative URLs line-by-line plus EXT-X-MEDIA URI rewriting for subtitles.
            let proxied_lines: Vec<String> = String::from_utf8_lossy(&bytes)
                .lines()
                .map(|line| {
                    let trimmed = line.trim();
                    if trimmed.starts_with("#EXT-X-MEDIA:") {
                        if let Some(uri_val) = extract_hls_uri(trimmed) {
                            let rewritten = rewrite_hls_url(&uri_val, &t.origin, &base, &ticket_base, &proxy_dir, &state.tickets, &t.headers);
                            let replaced = if line.contains(&format!("\"{}\"", uri_val)) {
                                line.replacen(&format!("\"{}\"", uri_val), &format!("\"{}\"", rewritten), 1)
                            } else if line.contains(&format!("'{}'", uri_val)) {
                                line.replacen(&format!("'{}'", uri_val), &format!("'{}'", rewritten), 1)
                            } else {
                                line.replacen(&format!("URI={}", uri_val), &format!("URI={}", rewritten), 1)
                            };
                            return replaced;
                        }
                        return line.to_string();
                    }
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        return line.to_string();
                    }
                    if trimmed.starts_with(&t.origin) {
                        let rel = trimmed[t.origin.len()..].trim_start_matches('/').to_string();
                        return format!("{base}/{rel}");
                    }
                    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                        let (foreign_ticket, _) = state.tickets.insert_dedup(trimmed.to_string(), t.headers.clone());
                        return format!("{ticket_base}/{foreign_ticket}");
                    }
                    if !trimmed.starts_with('/') {
                        return format!("{proxy_dir}{trimmed}");
                    }
                    line.to_string()
                })
                .collect();
            proxied_lines.join("\n")
        } else {
            // DASH: XML-aware rewrite (BaseURL / SegmentTemplate $Number$/$Time$) + subtitle foreign tickets.
            let rewritten = rewrite_dash_manifest_xml_aware(&String::from_utf8_lossy(&bytes), &t.origin, &base, &ticket_base, upstream.as_str(), &state.tickets, &t.headers);
            // The XML-aware pass already emits origin-relative `base/a/<path>` plus `ticket_base/<foreign>`
            // tickets. A blind origin→base string replace here would re-introduce the double-path 403, so
            // only absolutize leftovers NOT already under base.
            let mut dash_text = rewritten;
            // Ensure any remaining absolute http(s) URLs in BaseURL/SegmentTemplate media/initialization are ticketed
            dash_text = rewrite_dash_foreign_urls(&dash_text, &base, &ticket_base, &state.tickets, &t.headers);
            // Preserve $Number$/$Time$ placeholders verbatim — they are template variables, not URLs
            dash_text
        };
        // Preserve original content-type for HLS, override for DASH if missing
        let final_content_type =
            if content_type.contains("mpegurl") || content_type.contains("vnd.apple.mpegurl") {
                content_type.to_string()
            } else {
                "application/dash+xml".to_string()
            };
        // Cache rewritten manifest: TTL depends on type (VOD MPD 60s, live-ish HLS 5s via MANIFEST_CACHE_TTL)
        let ttl = if is_hls { state.transcode_cfg.manifest_cache_ttl } else { Duration::from_secs(60) };
        // Keep ETag from upstream if present, else generate a weak one from content hash
                let cache_etag = upstream_etag.clone().or_else(|| Some(format!("W/\"{}\"", text.len().wrapping_mul(31).wrapping_add(text.bytes().fold(0usize, |a,b| a.wrapping_add(b as usize))))));
        state.manifest_cache.insert(cache_key.clone(), text.clone(), final_content_type.clone(), cache_etag.clone(), ttl);
        out.insert(
            axum::http::header::CONTENT_TYPE,
            HeaderValue::from_str(&final_content_type)
                .unwrap_or(HeaderValue::from_static("application/octet-stream")),
        );
        out.insert(
            axum::http::header::CONTENT_LENGTH,
            HeaderValue::from_str(&text.len().to_string()).unwrap(),
        );
        if let Some(ref et) = cache_etag { if let Ok(v) = HeaderValue::from_str(et) { out.insert(header::ETAG, v); } }
        out.insert(header::CACHE_CONTROL, HeaderValue::from_static(if is_hls { "public, max-age=5" } else { "public, max-age=60" }));
        // _flight_guard drops here, releasing single-flight
        drop(_flight_guard);
        return (StatusCode::OK, out, Body::from(text.into_bytes())).into_response();
    }

    if let Some(len) = resp.content_length() {
        out.insert(
            axum::http::header::CONTENT_LENGTH,
            HeaderValue::from_str(&len.to_string()).unwrap(),
        );
    }
    if status.is_client_error() || status.is_server_error() {
        log::warn!("proxy_fetch: upstream {status} for ticket={ticket} rest={rest:?} upstream={upstream}");
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
async fn resolve_ffprobe() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MOVIEBOX_FFPROBE_PATH") {
        if !p.trim().is_empty() {
            let p = PathBuf::from(p.trim());
            let is_file = tokio::fs::metadata(&p)
                .await
                .map(|m| m.is_file())
                .unwrap_or(false);
            return is_file.then_some(p);
        }
    }
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let candidate = dir.join("ffprobe");
        if tokio::fs::metadata(&candidate)
            .await
            .map(|m| m.is_file())
            .unwrap_or(false)
        {
            return Some(candidate);
        }
    }
    None
}

async fn resolve_ffmpeg() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MOVIEBOX_FFMPEG_PATH") {
        if !p.trim().is_empty() {
            let p = PathBuf::from(p.trim());
            let is_file = tokio::fs::metadata(&p)
                .await
                .map(|m| m.is_file())
                .unwrap_or(false);
            return is_file.then_some(p);
        }
    }
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let candidate = dir.join("ffmpeg");
        if tokio::fs::metadata(&candidate)
            .await
            .map(|m| m.is_file())
            .unwrap_or(false)
        {
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
/// Format seconds as WebVTT timestamp HH:MM:SS.mmm (or MM:SS.mmm when <1h is handled by parser)
fn format_vtt_time(secs: f64) -> String {
    let total_ms = (secs.max(0.0) * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let total_s = total_ms / 1000;
    let s = total_s % 60;
    let total_m = total_s / 60;
    let m = total_m % 60;
    let h = total_m / 60;
    if h > 0 {
        format!("{h:02}:{m:02}:{s:02}.{ms:03}")
    } else {
        format!("{m:02}:{s:02}.{ms:03}")
    }
}

/// Write a WebVTT thumbnail index for the given duration. Each entry spans
/// `interval` seconds and points at a tiled sprite sheet where 100 thumbs
/// (10x10) share one JPEG. Coordinates are derived from the tile grid so the
/// client can do `sprite-#/ #xywh` lookups without parsing the image.
fn generate_thumbs_vtt(dir: &std::path::Path, duration: Option<f64>, interval: u64) -> std::io::Result<()> {
    let dur = duration.unwrap_or(7200.0).max(interval as f64);
    let interval_f = interval as f64;
    let mut count = (dur / interval_f).ceil() as u64;
    if count == 0 {
        count = 1;
    }
    // Guard against runaway files (10h at 1s interval would be 36k lines).
    count = count.min(3600);
    let mut vtt = String::from("WEBVTT\n\n");
    for i in 0..count {
        let start = i as f64 * interval_f;
        let end = ((i + 1) as f64 * interval_f).min(dur);
        let sprite_idx = i / 100;
        let pos = i % 100;
        let col = pos % 10;
        let row = pos / 10;
        let x = col * 160;
        let y = row * 90;
        vtt.push_str(&format!(
            "{} --> {}\n",
            format_vtt_time(start),
            format_vtt_time(end)
        ));
        vtt.push_str(&format!("sprite-{sprite_idx}.jpg#xywh={x},{y},160,90\n\n"));
    }
    std::fs::write(dir.join("thumbs.vtt"), vtt)
}

fn sprite_args(cfg: &TranscodeConfig, manifest_url: &str, dir: &std::path::Path) -> Vec<String> {
    let vf = format!("fps=1/{},scale=160:90,tile=10x10", cfg.sprite_interval);
    let pattern = dir.join("sprite-%d.jpg");
    vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-y".to_string(),
        "-skip_frame".to_string(),
        "nokey".to_string(),
        "-i".to_string(),
        manifest_url.to_string(),
        "-vf".to_string(),
        vf,
        "-an".to_string(),
        "-vsync".to_string(),
        "vfr".to_string(),
        "-qscale:v".to_string(),
        "4".to_string(),
        pattern.to_string_lossy().into_owned(),
    ]
}

fn spawn_sprite_generation(
    store: Arc<TranscodeStore>,
    session_id: String,
    manifest_url: String,
    dir: PathBuf,
    cfg: Arc<TranscodeConfig>,
    duration: Option<f64>,
    ffmpeg: PathBuf,
) {
    // Deadlock rule: never hold the registry lock across await/spawn beyond
    // the short check below. The actual ffmpeg spawn happens after the lock
    // is released.
    let already = {
        let map = store.inner.lock();
        map.get(&session_id)
            .map(|s| s.sprite_child.is_some())
            .unwrap_or(true)
    };
    if already {
        return;
    }
    // Pre-generate VTT immediately so the client can fetch it before any
    // JPEG finishes — sprites are resolved via the same dir.
    if let Err(e) = generate_thumbs_vtt(&dir, duration, cfg.sprite_interval) {
        log::warn!("transcode[{}]: failed writing thumbs.vtt: {e}", session_id);
    } else {
        log::info!(
            "transcode[{}]: wrote thumbs.vtt (interval {}s, duration {:?})",
            session_id,
            cfg.sprite_interval,
            duration
        );
    }
    let store_clone = store.clone();
    tokio::task::spawn(async move {
        let mut cmd = tokio::process::Command::new(&ffmpeg);
        cmd.args(sprite_args(&cfg, &manifest_url, &dir))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let child = match cmd.spawn() {
            Ok(mut c) => {
                if let Some(out) = c.stdout.take() {
                    spawn_ffmpeg_drain(out, format!("{session_id}-sprite"));
                }
                if let Some(err) = c.stderr.take() {
                    spawn_ffmpeg_drain(err, format!("{session_id}-sprite"));
                }
                c
            }
            Err(e) => {
                log::warn!("transcode[{}]: sprite ffmpeg spawn failed: {e}", session_id);
                return;
            }
        };
        // Register the sprite child so cleanup and on-demand checks see it.
        {
            let mut map = store_clone.inner.lock();
            if let Some(s) = map.get_mut(&session_id) {
                if s.sprite_child.is_none() {
                    s.sprite_child = Some(child);
                } else {
                    // Another task raced us; drop this child.
                    return;
                }
            } else {
                // Session vanished before we could register.
                return;
            }
        }
        log::info!(
            "transcode[{}]: sprite ffmpeg started (interval {}s) -> {}",
            session_id,
            cfg.sprite_interval,
            dir.display()
        );
        // The child runs to completion (or is killed on cleanup). We don't
        // block the handler — the watcher will notice exit via try_wait on
        // the main child only; sprite child is fire-and-forget except for
        // cleanup. Poll it ourselves to log completion.
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let done = {
                let mut map = store_clone.inner.lock();
                match map.get_mut(&session_id) {
                    Some(s) => match s.sprite_child.as_mut() {
                        Some(c) => match c.try_wait() {
                            Ok(Some(status)) => {
                                log::info!("transcode[{}]: sprite ffmpeg exited: {status:?}", session_id);
                                s.sprite_child = None;
                                true
                            }
                            Ok(None) => false,
                            Err(e) => {
                                log::warn!("transcode[{}]: sprite try_wait error: {e}", session_id);
                                false
                            }
                        },
                        None => true,
                    },
                    None => true,
                }
            };
            if done {
                break;
            }
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
/// Sprite sheets (`sprite-N.jpg`) and `thumbs.vtt` are keyed to absolute
/// content time and MUST NOT be deleted on seek.
async fn wipe_transcode_outputs(dir: &std::path::Path) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == "thumbs.vtt" || (name.starts_with("sprite-") && name.ends_with(".jpg")) {
            continue;
        }
        let is_output = name == "index.m3u8"
            || (name.starts_with("seg") && (name.ends_with(".ts") || name.ends_with(".tmp")));
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
    let mut sprite = session.sprite_child;
    if let Some(c) = sprite.as_mut() {
        let _ = c.kill().await;
        let _ = c.wait().await;
    }
    drop(sprite);
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
                let Some(s) = map.get_mut(&session_id) else {
                    return;
                };
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
                headers: ticket.headers.clone(),
                raw_url: ticket.raw_url.clone(),
                origin: ticket.origin.clone(),
                manifest_url: manifest_url.clone(),
                dir: dir.clone(),
                child: None,
                sprite_child: None,
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
            spawn_transcode_watcher(store.clone(), session_id.clone());
            // Fire the thumbnail sprite pass (no lock held across await/spawn
            // inside). Thumbs are keyed to absolute time, so later seeks must
            // not wipe them.
            spawn_sprite_generation(
                store,
                session_id.clone(),
                manifest_url.clone(),
                dir.clone(),
                state.transcode_cfg.clone(),
                source_duration,
                ffmpeg.clone(),
            );
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
    if name.is_empty()
        || name.len() > 64
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
    {
        return false;
    }
    if name == "index.m3u8" {
        return true;
    }
    if name == "thumbs.vtt" {
        return true;
    }
    if name.starts_with("sprite-") && name.ends_with(".jpg") {
        let mid = &name[7..name.len() - 4];
        if !mid.is_empty() && mid.bytes().all(|b| b.is_ascii_digit()) {
            return true;
        }
    }
    // segNNNNN.ts (5-digit sequence from -hls_segment_filename seg%05d.ts).
    name.len() == 11
        && name.starts_with("seg")
        && name.ends_with(".ts")
        && name.as_bytes()[3..8].iter().all(u8::is_ascii_digit)
}

async fn transcode_state(State(state): State<AppState>, Path(session): Path<String>) -> Response {
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
            None => return api_error(StatusCode::NOT_FOUND, "unknown transcode session"),
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
                    None => return api_error(StatusCode::NOT_FOUND, "unknown transcode session"),
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

// ---------------------------------------------------------------------------
// Thumbnail sprites (B1): second ffmpeg pass
// ---------------------------------------------------------------------------
async fn transcode_sprites(State(state): State<AppState>, Path(session): Path<String>) -> Response {
    let (dir, duration, sprite_interval) = {
        let mut map = state.transcodes.inner.lock();
        let Some(s) = map.get_mut(&session) else {
            return api_error(StatusCode::NOT_FOUND, "unknown transcode session");
        };
        s.last_used = Instant::now();
        (s.dir.clone(), s.duration_seconds, state.transcode_cfg.sprite_interval)
    };
    // The VTT is generated synchronously at session start; if missing we
    // regenerate on demand (handles a race where the handler ran before
    // spawn_sprite_generation flushed).
    let vtt_path = dir.join("thumbs.vtt");
    if !vtt_path.exists() {
        if let Err(e) = generate_thumbs_vtt(&dir, duration, sprite_interval) {
            log::warn!("transcode[{}]: on-demand thumbs.vtt generation failed: {e}", session);
            return api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("failed generating thumbs.vtt: {e}"));
        }
    }
    if !vtt_path.exists() {
        return api_error(StatusCode::NOT_FOUND, "thumbs not ready");
    }
    Json(serde_json::json!({
        "session": session,
        "vtt_url": format!("/api/transcode/{session}/thumbs.vtt"),
    }))
    .into_response()
}

async fn transcode_file(
    State(state): State<AppState>,
    Path((session, name)): Path<(String, String)>,
    headers: HeaderMap,
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
    let file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return api_error(StatusCode::NOT_FOUND, "transcode file not ready");
        }
        Err(e) => {
            return api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("cannot read {}: {e}", path.display()),
            );
        }
    };
    let metadata = match file.metadata().await {
        Ok(m) => m,
        Err(e) => {
            return api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("cannot stat {}: {e}", path.display()),
            );
        }
    };
    let file_size = metadata.len();
    let content_type = if name.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else if name.ends_with(".vtt") {
        "text/vtt"
    } else if name.ends_with(".jpg") || name.ends_with(".jpeg") {
        "image/jpeg"
    } else if name.ends_with(".ts") {
        "video/mp2t"
    } else {
        "application/octet-stream"
    };
    // The live playlist is rewritten as ffmpeg produces segments: it must
    // never be cached, or hls.js freezes on the first 1-segment snapshot and
    // stalls at the end of seg00000. Segments are content-addressed per
    // session BUT their names are reused across seek restarts (seg00000.ts
    // is reborn at every seek point), so a long cache makes hls.js replay
    // the pre-seek bytes after a seek. Both are no-store; the steady-state
    // cost is one playlist + one segment fetch per 6s window.
    let cache_control = if name == "index.m3u8" || name.ends_with(".ts") {
        "no-store"
    } else {
        "public, max-age=31536000, immutable"
    };
    // Range support: parse `Range: bytes=...`
    if let Some(range_val) = headers.get(header::RANGE)
        && let Ok(range_str) = range_val.to_str()
        && let Some(parsed) = parse_range_header(range_str, file_size)
    {
        match parsed {
            Ok((start, end)) => {
                let length = end - start;
                let mut file = file;
                if let Err(e) = file.seek(SeekFrom::Start(start)).await {
                    return api_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("seek failed: {e}"),
                    );
                }
                let limited = file.take(length);
                let stream = ReaderStream::new(limited);
                let content_range = format!("bytes {}-{}/{}", start, end - 1, file_size);
                return (
                    StatusCode::PARTIAL_CONTENT,
                    [
                        (header::CONTENT_TYPE, HeaderValue::from_static(content_type)),
                        (
                            header::CONTENT_LENGTH,
                            HeaderValue::from_str(&length.to_string()).unwrap(),
                        ),
                        (
                            header::CONTENT_RANGE,
                            HeaderValue::from_str(&content_range).unwrap(),
                        ),
                        (header::ACCEPT_RANGES, HeaderValue::from_static("bytes")),
                        (
                            header::CACHE_CONTROL,
                            HeaderValue::from_str(cache_control).unwrap(),
                        ),
                    ],
                    Body::from_stream(stream),
                )
                    .into_response();
            }
            Err(()) => {
                return (
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    [
                        (
                            header::CONTENT_RANGE,
                            HeaderValue::from_str(&format!("bytes */{file_size}")).unwrap(),
                        ),
                        (header::ACCEPT_RANGES, HeaderValue::from_static("bytes")),
                    ],
                    Body::empty(),
                )
                    .into_response();
            }
        }
    }
    let stream = ReaderStream::new(file);
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(content_type)),
            (
                header::CONTENT_LENGTH,
                HeaderValue::from_str(&file_size.to_string()).unwrap(),
            ),
            (header::ACCEPT_RANGES, HeaderValue::from_static("bytes")),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_str(cache_control).unwrap(),
            ),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}

async fn transcode_delete(State(state): State<AppState>, Path(session): Path<String>) -> Response {
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
    let ffmpeg_ok = tokio::fs::metadata(&state.transcode_cfg.ffmpeg_path).await.map(|m| m.is_file()).unwrap_or(false)
        || resolve_ffmpeg().await.is_some();
    Json(serde_json::json!({
        "ok": true,
        "service": "moviebox-server",
        "version": env!("CARGO_PKG_VERSION"),
        "region": moviebox_tui::config::moviebox_region(),
        "providers": providers,
        "transcode": {
            "enabled": state.transcode_cfg.enabled,
            "ffmpeg": ffmpeg_ok,
        }
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
        env_logger::Env::default().default_filter_or("moviebox_server=debug,moviebox_tui=info"),
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
            "transcode gateway enabled: base={}, ffmpeg={}, preset={}, crf={}, sprite_interval={}s",
            transcode_cfg.base_dir.display(),
            transcode_cfg.ffmpeg_path,
            transcode_cfg.preset,
            transcode_cfg.crf,
            transcode_cfg.sprite_interval
        );
    } else {
        log::info!("transcode gateway disabled (TRANSCODE_ENABLED != 1)");
    }
    let transcodes_for_janitor = transcodes.clone();
    let janitor_base = transcode_cfg.base_dir.clone();
    let janitor_enabled = transcode_cfg.enabled;
    let state = AppState {
        svc,
        tickets: Arc::new(TicketStore::default()),
        proxy_client,
        proxy_base,
        transcodes,
        transcode_cfg,
        manifest_cache: Arc::new(ManifestCache::new()),
        mirror_health: Arc::new(MirrorHealthCache::new()),
        ticket_metas: Arc::new(TicketMetaStore::new()),
    };
    if janitor_enabled {
        spawn_transcode_janitor(transcodes_for_janitor, janitor_base);
    }
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
        .route("/api/subtitles/search", get(subtitle_search))
        .route("/api/skip-markers", get(skip_markers))
        .route("/api/play", post(play))
        .route("/api/proxy/ticket", post(create_ticket))
        .route("/api/proxy/{ticket}/rotate", post(proxy_rotate))
        .route("/api/proxy/{ticket}", get(proxy_fetch_root))
        .route("/api/proxy/{ticket}/{*rest}", get(proxy_fetch))
        .route("/api/transcode/start", post(transcode_start))
        .route("/api/transcode/{session}/state", get(transcode_state))
        .route("/api/transcode/{session}/seek", post(transcode_seek))
        .route("/api/transcode/{session}/sprites", get(transcode_sprites))
        .route("/api/transcode/{session}/{*rest}", get(transcode_file))
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

#[cfg(test)]
mod proxy_rewrite_tests {
    use super::*;

    fn rig() -> (String, String, String, TicketStore) {
        (
            "https://cdn.example.com".to_string(),
            "https://cine.archlast.com/api/proxy/TESTTICKET/a".to_string(),
            "https://cine.archlast.com/api/proxy/TESTTICKET".to_string(),
            TicketStore::default(),
        )
    }

    #[test]
    fn relative_template_rewrites_to_proxy_relative_form() {
        let (origin, base, ticket_base, tickets) = rig();
        // Qualified template at the manifest dir: manifest at /dash/abc123/index.mpd, template carries the
        // same dir prefix. Emitted origin-relative as-is (proxy rebuilds origin + path).
        let mpd = r#"<MPD><Period><AdaptationSet><SegmentTemplate media="dash/abc123/chunk-stream$Number$.m4s" initialization="dash/abc123/init-stream$Number$.m4s"/></AdaptationSet></Period></MPD>"#;
        let out = rewrite_dash_manifest_xml_aware(mpd, &origin, &base, &ticket_base, "https://cdn.example.com/dash/abc123/index.mpd", &tickets, &[]);
        assert!(out.contains("https://cine.archlast.com/api/proxy/TESTTICKET/a/dash/abc123/chunk-stream$Number$.m4s"), "media template must be proxy-relative, got: {out}");
        assert!(out.contains("https://cine.archlast.com/api/proxy/TESTTICKET/a/dash/abc123/init-stream$Number$.m4s"), "init template must be proxy-relative, got: {out}");
        assert!(!out.contains("/a/a/"), "must not double the /a/ prefix, got: {out}");
    }

    #[test]
    fn absolute_same_origin_template_rewrites_without_double_path() {
        let (origin, base, ticket_base, tickets) = rig();
        let mpd = r#"<MPD><Period><AdaptationSet><SegmentTemplate media="https://cdn.example.com/dash/abc123/chunk-stream$Number$.m4s" initialization="https://cdn.example.com/dash/abc123/init-stream$Number$.m4s"/></AdaptationSet></Period></MPD>"#;
        let out = rewrite_dash_manifest_xml_aware(mpd, &origin, &base, &ticket_base, "https://cdn.example.com/videos/x/manifest.mpd", &tickets, &[]);
        assert!(out.contains("/a/dash/abc123/chunk-stream$Number$.m4s"), "absolute template must stay single-path, got: {out}");
        assert!(!out.contains("cdn.example.com/dash") || out.contains("/api/proxy/TESTTICKET/a/dash"), "no raw upstream host must leak, got: {out}");
    }

    #[test]
    fn bare_template_name_resolves_against_manifest_directory() {
        // Real MovieBox shape: manifest at /dash/<id>/index.mpd, templates are bare filenames.
        let (origin, base, ticket_base, tickets) = rig();
        let mpd = r#"<MPD><Period><AdaptationSet><SegmentTemplate media="chunk-stream$Number$.m4s" initialization="init-stream$Number$.m4s"/></AdaptationSet></Period></MPD>"#;
        let out = rewrite_dash_manifest_xml_aware(mpd, &origin, &base, &ticket_base, "https://cdn.example.com/dash/abc123/index.mpd", &tickets, &[]);
        assert!(out.contains("https://cine.archlast.com/api/proxy/TESTTICKET/a/dash/abc123/init-stream$Number$.m4s"), "bare init template must keep manifest dir, got: {out}");
        assert!(out.contains("https://cine.archlast.com/api/proxy/TESTTICKET/a/dash/abc123/chunk-stream$Number$.m4s"), "bare media template must keep manifest dir, got: {out}");
    }
}
