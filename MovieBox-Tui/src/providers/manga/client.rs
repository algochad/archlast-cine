use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

use crate::providers::models::{
    CatalogItem, MediaDetails, MediaType, ProviderError, ProviderKind, ProviderMediaId,
};
use crate::providers::ProviderCapabilities;

const MANGA_API_DEFAULT_URL: &str = "http://127.0.0.1:8080";
const MANGA_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MANGA_MAX_RETRIES: usize = 2;

pub fn manga_api_url() -> String {
    std::env::var("MANGA_API_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| MANGA_API_DEFAULT_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

/// User-visible copy for manga unavailability, mirroring the anime provider.
const MANGA_UNAVAILABLE: &str =
    "Manga isn't available right now. Try again or pick another source.";

// ── MangaScrapper wire types (camelCase, enveloped in ApiResponse<T>) ──────

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    #[serde(default)]
    success: bool,
    data: Option<T>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PagedResponse<T> {
    items: Vec<T>,
    total_count: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaSummary {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub genres: Option<Vec<String>>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub local_image_url: Option<String>,
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub nsfw: Option<bool>,
    #[serde(default)]
    pub release_date: Option<String>,
    #[serde(default)]
    pub latest_chapter: Option<MangaChapterSummary>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaChapterSummary {
    pub id: String,
    #[serde(default)]
    pub number: f64,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub upload_date: Option<String>,
    #[serde(default)]
    pub total_pages: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaChapterPage {
    #[serde(default)]
    pub url: Option<String>,
    pub width: i64,
    pub height: i64,
    #[serde(default)]
    pub alternate_url: Option<String>,
    #[serde(default)]
    pub is_fallback: bool,
}

#[derive(Debug, Deserialize)]
struct MangaChapter {
    id: String,
    #[serde(default)]
    number: f64,
    #[serde(default)]
    language: String,
    #[serde(default)]
    upload_date: Option<String>,
    #[serde(default)]
    total_pages: i64,
    #[serde(default)]
    pages: Option<Vec<MangaChapterPage>>,
}

/// A chapter with pages loaded, as returned by the chapter detail endpoint.
pub struct MangaChapterDetail {
    pub id: String,
    pub number: f64,
    pub language: String,
    pub upload_date: Option<String>,
    pub total_pages: i64,
    pub pages: Vec<MangaChapterPage>,
}

// ── Provider ───────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct MangaProvider {
    http: Client,
}

impl MangaProvider {
    pub fn new() -> Self {
        let http = Client::builder()
            .timeout(MANGA_REQUEST_TIMEOUT)
            .build()
            .unwrap_or_default();
        Self { http }
    }

    fn media_id(id: &str) -> ProviderMediaId {
        ProviderMediaId {
            provider: ProviderKind::Manga,
            value: id.to_string(),
        }
    }

    /// Resolve a MangaScrapper-relative image path to an absolute URL.
    /// Stored paths are relative to the API host's `/images` static root; a
    /// leading `/` or absolute URL is used as-is.
    pub fn resolve_image_url(path: &str) -> Option<String> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return None;
        }
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            return Some(trimmed.to_string());
        }
        let base = manga_api_url();
        if trimmed.starts_with('/') {
            Some(format!("{base}{trimmed}"))
        } else {
            Some(format!("{base}/images/{trimmed}"))
        }
    }

    /// Percent-encode a value for use inside a query string (path separators
    /// and unreserved characters pass through).
    fn encode_query_value(value: &str) -> String {
        let mut out = String::with_capacity(value.len());
        for b in value.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                    out.push(b as char)
                }
                _ => out.push_str(&format!("%{b:02X}")),
            }
        }
        out
    }

    /// Same-origin proxy path the browser loads images through — the raw
    /// MangaScrapper path/URL travels in the `url` query param and the
    /// `/api/manga/image` route resolves it against the manga API host.
    pub fn proxy_image_path(path: &str) -> Option<String> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(format!(
            "/api/manga/image?url={}",
            Self::encode_query_value(trimmed)
        ))
    }

    fn poster_url(summary: &MangaSummary) -> Option<String> {
        summary
            .local_image_url
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                summary
                    .image_url
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
            })
            .and_then(Self::proxy_image_path)
    }

    fn year_text(summary: &MangaSummary) -> Option<String> {
        summary
            .release_date
            .as_deref()
            .and_then(|d| d.get(0..4))
            .map(str::to_string)
            .filter(|y| y.chars().all(|c| c.is_ascii_digit()))
    }

    pub fn to_catalog_item(summary: &MangaSummary) -> CatalogItem {
        CatalogItem {
            id: Self::media_id(&summary.id),
            title: if summary.title.trim().is_empty() {
                "Unknown Manga".to_string()
            } else {
                summary.title.clone()
            },
            media_type: MediaType::Manga,
            year: Self::year_text(summary),
            poster_url: Self::poster_url(summary),
            season_count: None,
        }
    }

    fn to_details(summary: &MangaSummary) -> MediaDetails {
        let mut details = MediaDetails {
            id: Self::media_id(&summary.id),
            title: if summary.title.trim().is_empty() {
                "Unknown Manga".to_string()
            } else {
                summary.title.clone()
            },
            media_type: MediaType::Manga,
            year: Self::year_text(summary),
            description: summary.description.clone(),
            tagline: summary.status.clone(),
            imdb_rating: summary.rating.map(|r| format!("{r:.1}")),
            director: if summary.author.trim().is_empty() {
                None
            } else {
                Some(summary.author.clone())
            },
            stars: None,
            prints: None,
            audios: None,
            poster_url: Self::poster_url(summary),
            duration: None,
            genres: summary.genres.clone().unwrap_or_default(),
            seasons: Vec::new(),
            dubs: Vec::new(),
        };
        // Latest chapter count surfaces where episode metadata usually lives.
        if let Some(latest) = summary.latest_chapter.as_ref() {
            details.duration = Some(format!("Chapter {}", latest.number));
        }
        details
    }

    /// GET a JSON endpoint, unwrapping the ApiResponse envelope. Retries on
    /// 429 with the server's Retry-After hint (capped) before giving up.
    async fn get_enveloped<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T, ProviderError> {
        let base = manga_api_url();
        let url = format!("{base}{path}");
        let mut last_rate_limited = false;

        for attempt in 0..=MANGA_MAX_RETRIES {
            let response = self
                .http
                .get(&url)
                .query(query)
                .send()
                .await
                .map_err(|e| ProviderError::Network(e.to_string()))?;

            match response.status() {
                reqwest::StatusCode::TOO_MANY_REQUESTS => {
                    last_rate_limited = true;
                    if attempt == MANGA_MAX_RETRIES {
                        break;
                    }
                    let wait = response
                        .headers()
                        .get("Retry-After")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.trim().parse::<u64>().ok())
                        .unwrap_or(2)
                        .min(10);
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                }
                status if !status.is_success() => {
                    if status == reqwest::StatusCode::NOT_FOUND {
                        return Err(ProviderError::NotFound);
                    }
                    return Err(ProviderError::Unavailable(format!(
                        "manga api returned {status}"
                    )));
                }
                _ => {
                    let envelope: ApiResponse<T> = response
                        .json()
                        .await
                        .map_err(|e| ProviderError::Parsing(e.to_string()))?;
                    return match (envelope.success, envelope.data) {
                        (true, Some(data)) => Ok(data),
                        (true, None) => Err(ProviderError::NotFound),
                        (false, _) => Err(ProviderError::Unavailable(
                            envelope
                                .message
                                .unwrap_or_else(|| "manga api error".to_string()),
                        )),
                    };
                }
            }
        }

        if last_rate_limited {
            Err(ProviderError::RateLimited(None))
        } else {
            Err(ProviderError::Unavailable(MANGA_UNAVAILABLE.to_string()))
        }
    }

    /// Paged catalog: `/api/v1/manga`.
    pub async fn list(
        &self,
        search: Option<&str>,
        page: usize,
        page_size: usize,
    ) -> Result<(Vec<MangaSummary>, i64), ProviderError> {
        let mut query: Vec<(String, String)> = Vec::new();
        if let Some(search) = search.filter(|s| !s.trim().is_empty()) {
            query.push(("search".into(), search.trim().to_string()));
        }
        query.push(("page".into(), page.max(1).to_string()));
        query.push(("pageSize".into(), page_size.clamp(1, 50).to_string()));
        let query_refs: Vec<(&str, &str)> =
            query.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let paged: PagedResponse<MangaSummary> = self
            .get_enveloped("/api/v1/manga", &query_refs)
            .await?;
        Ok((paged.items, paged.total_count))
    }

    /// Trending row: `/api/v1/manga/trending`.
    pub async fn trending(&self, page: usize, page_size: usize) -> Result<Vec<MangaSummary>, ProviderError> {
        let paged: PagedResponse<MangaSummary> = self
            .get_enveloped(
                "/api/v1/manga/trending",
                &[
                    ("page", page.max(1).to_string().as_str()),
                    ("pageSize", page_size.clamp(1, 50).to_string().as_str()),
                ],
            )
            .await?;
        Ok(paged.items)
    }

    /// Chapter list for a manga: `/api/v1/manga/{id}/chapters`.
    pub async fn chapters(&self, manga_id: &str) -> Result<Vec<MangaChapterSummary>, ProviderError> {
        let path = format!("/api/v1/manga/{manga_id}/chapters");
        let chapters: Vec<MangaChapter> = self.get_enveloped(&path, &[]).await?;
        Ok(chapters
            .into_iter()
            .map(|c| MangaChapterSummary {
                id: c.id,
                number: c.number,
                language: c.language,
                upload_date: c.upload_date,
                total_pages: c.total_pages,
            })
            .collect())
    }

    /// Chapter with pages: `/api/v1/manga/{mangaId}/chapters/{chapterId}`.
    pub async fn chapter_detail(
        &self,
        manga_id: &str,
        chapter_id: &str,
    ) -> Result<MangaChapterDetail, ProviderError> {
        let path = format!("/api/v1/manga/{manga_id}/chapters/{chapter_id}");
        let chapter: MangaChapter = self.get_enveloped(&path, &[]).await?;
        Ok(MangaChapterDetail {
            id: chapter.id,
            number: chapter.number,
            language: chapter.language,
            upload_date: chapter.upload_date,
            total_pages: chapter.total_pages,
            pages: chapter.pages.unwrap_or_default(),
        })
    }
}

impl Default for MangaProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl crate::providers::Provider for MangaProvider {
    fn id(&self) -> ProviderKind {
        ProviderKind::Manga
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_search: true,
            supports_pagination: true,
            supports_series: false,
            supports_subtitles: false,
            supports_homepage: false,
        }
    }

    async fn search(&self, query: &str, page: usize) -> Result<Vec<CatalogItem>, ProviderError> {
        let (summaries, _) = self.list(Some(query), page, 25).await?;
        Ok(summaries.iter().map(Self::to_catalog_item).collect())
    }

    async fn details(&self, id: &str) -> Result<MediaDetails, ProviderError> {
        let path = format!("/api/v1/manga/{id}");
        let summary: MangaSummary = self.get_enveloped(&path, &[]).await?;
        Ok(Self::to_details(&summary))
    }
}