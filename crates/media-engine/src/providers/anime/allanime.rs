//! AllAnime scraper: resolves episode stream sources via AllAnime's GraphQL API.
//!
//! AllAnime exposes the GraphQL endpoint its web player uses. Entries in
//! `sourceUrls` are `<mirror_id>:<url>` pairs; mirror id "1" is AllAnime's
//! internal player while other ids map to embed providers.

use reqwest::Client;
use serde::Deserialize;
use std::future::Future;
use std::time::Duration;

use crate::providers::models::ProviderError;

const API_ENDPOINT: &str = "https://api.allanime.day/api";
const SITE_ORIGIN: &str = "https://allanime.to/";
const TRANSLATION_TYPE: &str = "sub";

const MAX_ATTEMPTS: usize = 4;
const INITIAL_BACKOFF_MS: u64 = 500;

const SEARCH_QUERY: &str = r#"
query ($search: SearchInput, $limit: Int, $page: Int, $translationType: VaildTranslationTypeEnumType, $countryOrigin: VaildCountryOriginEnumType) {
  shows(search: $search, limit: $limit, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
    edges {
      _id
      name
      englishName
    }
  }
}
"#;

const EPISODE_QUERY: &str = r#"
query ($showId: String!, $translationType: VaildTranslationEnumType!, $episodeString: String!) {
  episode(showId: $showId, translationType: $translationType, episodeString: $episodeString) {
    sourceUrls
  }
}
"#;

#[derive(Debug, Deserialize)]
struct GraphQlEnvelope<T> {
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct SearchData {
    #[serde(default)]
    shows: Option<SearchShows>,
}

#[derive(Debug, Deserialize)]
struct SearchShows {
    #[serde(default)]
    edges: Vec<ShowEdge>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowEdge {
    #[serde(rename = "_id")]
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    english_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EpisodeData {
    #[serde(default)]
    episode: Option<EpisodeNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EpisodeNode {
    #[serde(default)]
    source_urls: Vec<String>,
}

async fn post_graphql<T: for<'de> Deserialize<'de>>(
    http: &Client,
    query: &str,
    variables: serde_json::Value,
) -> Result<T, ProviderError> {
    let body = serde_json::json!({ "query": query, "variables": variables });
    let response = http
        .post(API_ENDPOINT)
        .header("Referer", SITE_ORIGIN)
        .json(&body)
        .send()
        .await
        .map_err(|e| ProviderError::Network(e.to_string()))?;

    let status = response.status();
    if status.as_u16() == 429 {
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        return Err(ProviderError::RateLimited(retry_after));
    }
    if !status.is_success() {
        return Err(ProviderError::Unavailable(format!(
            "AllAnime returned HTTP {status}"
        )));
    }

    let envelope: GraphQlEnvelope<T> = response
        .json()
        .await
        .map_err(|e| ProviderError::Parsing(e.to_string()))?;
    envelope
        .data
        .ok_or_else(|| ProviderError::Parsing("AllAnime response contained no data".to_string()))
}

/// Exponential-backoff retry wrapper mirroring the moviebox client pattern.
async fn with_backoff<T, F, Fut>(mut op: F) -> Result<T, ProviderError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, ProviderError>>,
{
    let mut delay = Duration::from_millis(INITIAL_BACKOFF_MS);
    let mut last_err = None;
    for _ in 0..MAX_ATTEMPTS {
        match op().await {
            Ok(value) => return Ok(value),
            Err(e @ ProviderError::RateLimited(_)) => last_err = Some(e),
            Err(e @ ProviderError::Network(_)) => last_err = Some(e),
            Err(e) => return Err(e),
        }
        tokio::time::sleep(delay).await;
        delay = delay.saturating_mul(2);
    }
    Err(last_err
        .unwrap_or_else(|| ProviderError::Unavailable("AllAnime retries exhausted".to_string())))
}

/// Find the AllAnime show id best matching a title.
///
/// AllAnime search ranking does not always surface the canonical series
/// first, so several edges are fetched and an exact name match is preferred
/// before falling back to the top result.
pub async fn find_show_id(http: &Client, title: &str) -> Result<String, ProviderError> {
    let data: SearchData = with_backoff(|| {
        let variables = serde_json::json!({
            "search": { "query": title, "allowAdult": false, "allowUnknown": true },
            "limit": 10,
            "page": 1,
            "translationType": TRANSLATION_TYPE,
            "countryOrigin": "ALL"
        });
        post_graphql(http, SEARCH_QUERY, variables)
    })
    .await?;

    let edges = data.shows.map(|shows| shows.edges).unwrap_or_default();
    if edges.is_empty() {
        return Err(ProviderError::NotFound);
    }
    let needle = title.trim().to_lowercase();
    let best = edges
        .iter()
        .find(|edge| {
            edge.name
                .as_deref()
                .is_some_and(|name| name.trim().to_lowercase() == needle)
        })
        .or_else(|| {
            edges.iter().find(|edge| {
                edge.english_name
                    .as_deref()
                    .is_some_and(|name| name.trim().to_lowercase() == needle)
            })
        })
        .unwrap_or(&edges[0]);
    Ok(best.id.clone())
}

/// Fetch the raw `sourceUrls` entries for one episode of a show.
pub async fn episode_source_urls(
    http: &Client,
    show_id: &str,
    episode_string: &str,
) -> Result<Vec<String>, ProviderError> {
    let data: EpisodeData = with_backoff(|| {
        let variables = serde_json::json!({
            "showId": show_id,
            "translationType": TRANSLATION_TYPE,
            "episodeString": episode_string
        });
        post_graphql(http, EPISODE_QUERY, variables)
    })
    .await?;
    Ok(data
        .episode
        .map(|node| node.source_urls)
        .unwrap_or_default())
}

/// Display label for an AllAnime mirror id ("1" is the internal player).
pub fn mirror_label(mirror_id: &str) -> String {
    match mirror_id {
        "1" => "AllAnime".to_string(),
        _ => format!("Mirror {mirror_id}"),
    }
}

/// Headers a player should send when fetching the given stream URL.
pub fn mirror_headers(url: &str) -> Vec<(String, String)> {
    if url.contains("allanime") {
        vec![("Referer".to_string(), SITE_ORIGIN.to_string())]
    } else {
        Vec::new()
    }
}

/// Whether the URL points directly at a video file (no embed decoding needed).
pub fn is_direct_file(url: &str) -> bool {
    url.ends_with(".m3u8") || url.ends_with(".mp4")
}

/// Heuristic quality detection from a stream URL.
pub fn detect_quality(url: &str) -> Option<String> {
    const MARKERS: [&str; 5] = ["2160", "1080", "720", "480", "360"];
    MARKERS
        .iter()
        .find(|marker| url.contains(*marker))
        .map(|marker| format!("{marker}p"))
}

/// Heuristic codec detection from a stream URL.
pub fn detect_codec(url: &str) -> Option<String> {
    if url.contains(".m3u8") {
        Some("hls".to_string())
    } else if url.contains(".mp4") {
        Some("h264".to_string())
    } else {
        None
    }
}