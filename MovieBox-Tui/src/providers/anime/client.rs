use reqwest::Client;
use serde::Deserialize;

use crate::providers::models::{
    AudioTrackOption, CatalogItem, Episode, MediaDetails, MediaType,
    ProviderError, ProviderKind, ProviderMediaId, Release, Season,
};
use crate::providers::ProviderCapabilities;
use aes::Aes256;
use ctr::cipher::{KeyIvInit, StreamCipher};
use sha2::{Sha256, Digest};
use base64::{Engine as _, engine::general_purpose};

type Aes256Ctr = ctr::Ctr128BE<Aes256>;

const ALLANIME_API_ENDPOINT: &str = "https://api.allanime.day/api";
const ALLANIME_PERSISTED_QUERY_HASH: &str = "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec";
const ALLANIME_CRYPTO_KEY: &str = "Xot36i3lK3:v1";

const SENSHI_BASE_URL: &str = "https://senshi.live";
const ANIME_RESOLVER_URL: &str = "http://127.0.0.1:9798";

fn anime_resolver_url() -> String {
    std::env::var("ANIME_SIDECAR_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| ANIME_RESOLVER_URL.to_string())
}

/// User-visible copy for anime unavailability. Technical causes go to server
/// logs; this is the only anime-streams message the web UI may render.
const ANIME_UNAVAILABLE: &str =
    "This title isn't available right now. Try again or pick another source.";
const ANILIST_ENDPOINT: &str = "https://graphql.anilist.co";

const SEARCH_QUERY: &str = r#"
query ($page: Int, $perPage: Int, $search: String) {
  Page(page: $page, perPage: $perPage) {
    media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
      id
      idMal
      title { romaji english native }
      coverImage { large }
      bannerImage
      description
      genres
      season
      seasonYear
      episodes
      status
    }
  }
}
"#;

const DETAILS_QUERY: &str = r#"
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    title { romaji english native }
    coverImage { large extraLarge }
    bannerImage
    description
    genres
    studios { nodes { name } }
    season
    seasonYear
    episodes
    status
    relations {
      edges {
        relationType
        node { id idMal title { romaji } }
      }
    }
  }
}
"#;

const SEASONAL_QUERY: &str = r#"
query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
  Page(page: $page, perPage: $perPage) {
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
      id
      idMal
      title { romaji english native }
      coverImage { large }
      bannerImage
      description
      genres
      season
      seasonYear
      episodes
      status
    }
  }
}
"#;

const ALLANIME_ENDPOINT: &str = "https://api.allanime.day/api";

const ALLANIME_POPULAR_QUERY: &str = r#"
query($type: VaildPopularTypeEnumType!, $page: Int!, $size: Int!, $dateRange: Int) {
  queryPopular(type: $type, page: $page, size: $size, dateRange: $dateRange) {
    recommendations {
      anyCard {
        _id
        name
        englishName
        thumbnail
        banner
        availableEpisodesDetail
      }
    }
  }
}
"#;

const ALLANIME_SEARCH_QUERY: &str = r#"
query($q: String!, $page: Int!, $limit: Int!) {
  shows(search: { query: $q }, page: $page, limit: $limit) {
    edges {
      _id
      name
      englishName
      thumbnail
      banner
      availableEpisodesDetail
    }
  }
}
"#;

const ALLANIME_DETAILS_QUERY: &str = r#"
query($id: String!) {
  show(_id: $id) {
    _id
    name
    englishName
    thumbnail
    banner
    description
    genres
    season
    status
    availableEpisodesDetail
    studios
    episodeCount
  }
}
"#;

#[derive(Debug, Deserialize)]
struct AllAnimeResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct AllAnimePopularData {
    #[serde(rename = "queryPopular")]
    query_popular: Option<AllAnimePopular>,
}

#[derive(Debug, Deserialize)]
struct AllAnimePopular {
    recommendations: Vec<AllAnimeRecommendation>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeRecommendation {
    #[serde(rename = "anyCard")]
    any_card: Option<AllAnimeCard>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeSearchData {
    shows: Option<AllAnimeShows>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeShows {
    edges: Vec<AllAnimeCard>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeDetailsData {
    show: Option<AllAnimeCard>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AllAnimeCard {
    #[serde(rename = "_id")]
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    english_name: Option<String>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    banner: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    genres: Option<Vec<String>>,
    #[serde(default)]
    season: Option<serde_json::Value>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    available_episodes_detail: Option<serde_json::Value>,
    #[serde(default)]
    studios: Option<Vec<String>>,
    #[serde(default)]
    episode_count: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Default)]
struct AllAnimeSeason {
    #[serde(default)]
    year: Option<i64>,
    #[serde(default)]
    quarter: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct AllAnimeEpisodes {
    #[serde(default)]
    sub: Vec<String>,
    #[serde(default)]
    dub: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct PageData {
    media: Vec<AniListMedia>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AniListMedia {
    id: i64,
    #[serde(default)]
    id_mal: Option<i64>,
    #[serde(default)]
    title: AniListTitle,
    cover_image: Option<AniListCover>,
    #[serde(default)]
    banner_image: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    genres: Vec<String>,
    #[serde(default)]
    season: Option<String>,
    #[serde(default)]
    season_year: Option<i64>,
    #[serde(default)]
    episodes: Option<i64>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    studios: Option<AniListStudios>,
}

#[derive(Debug, Deserialize, Default)]
struct AniListTitle {
    #[serde(default)]
    romaji: Option<String>,
    #[serde(default)]
    english: Option<String>,
    #[serde(default)]
    native: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AniListCover {
    #[serde(default)]
    large: Option<String>,
    #[serde(default)]
    extra_large: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AniListStudios {
    #[serde(default)]
    nodes: Vec<AniListStudio>,
}

#[derive(Debug, Deserialize)]
struct AniListStudio {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Clone)]
pub struct AnimeProvider {
    http: Client,
}

impl AnimeProvider {
    pub fn new(http: Client) -> Self {
        Self { http }
    }

    fn pick_title(title: &AniListTitle) -> String {
        title
            .english
            .clone()
            .or_else(|| title.romaji.clone())
            .or_else(|| title.native.clone())
            .unwrap_or_else(|| "Unknown Anime".to_string())
    }

    fn year_text(media: &AniListMedia) -> Option<String> {
        media.season_year.map(|y| y.to_string())
    }

    fn episodes_count(media: &AniListMedia) -> usize {
        media.episodes.map(|e| e.max(0) as usize).unwrap_or(0)
    }

    fn seasons_for(media: &AniListMedia) -> Vec<Season> {
        let count = Self::episodes_count(media);
        if count == 0 {
            return Vec::new();
        }
        let episodes = (1..=count)
            .map(|number| Episode {
                season: 1,
                number,
                title: None,
            })
            .collect();
        vec![Season {
            number: 1,
            episodes,
        }]
    }

    fn clean_description(raw: Option<String>) -> Option<String> {
        raw.map(|text| {
            text.replace("<br>", "\n")
                .replace("<br/>", "\n")
                .replace("<br />", "\n")
                .replace("</p>", "\n\n")
                .replace("<i>", "")
                .replace("</i>", "")
                .replace("<b>", "")
                .replace("</b>", "")
                .replace("&amp;", "&")
                .replace("&quot;", "\"")
                .replace("&#039;", "'")
                .replace("&nbsp;", " ")
                .trim()
                .to_string()
        })
        .filter(|text| !text.is_empty())
    }

    fn media_id(media: &AniListMedia) -> ProviderMediaId {
        ProviderMediaId {
            provider: ProviderKind::Anime,
            value: media.id.to_string(),
        }
    }

    fn to_catalog_item(media: &AniListMedia) -> CatalogItem {
        CatalogItem {
            id: Self::media_id(media),
            title: Self::pick_title(&media.title),
            media_type: MediaType::Anime,
            year: Self::year_text(media),
            poster_url: media
                .cover_image
                .as_ref()
                .and_then(|c| c.large.clone())
                .or_else(|| media.banner_image.clone()),
            season_count: if Self::episodes_count(media) > 1 {
                Some(1)
            } else {
                None
            },
        }
    }

    fn to_details(media: &AniListMedia) -> MediaDetails {
        let episodes_count = Self::episodes_count(media);
        let duration = if episodes_count > 1 {
            Some(format!("{episodes_count} episodes"))
        } else {
            None
        };
        let director = media
            .studios
            .as_ref()
            .and_then(|s| s.nodes.first())
            .and_then(|n| n.name.clone());

        MediaDetails {
            id: Self::media_id(media),
            title: Self::pick_title(&media.title),
            media_type: MediaType::Anime,
            year: Self::year_text(media),
            description: Self::clean_description(media.description.clone()),
            tagline: media.season.clone().map(|season| {
                let year = media
                    .season_year
                    .map(|y| format!(" {y}"))
                    .unwrap_or_default();
                format!("{season}{year}")
            }),
            imdb_rating: None,
            director,
            stars: None,
            prints: None,
            audios: None,
            poster_url: media
                .cover_image
                .as_ref()
                .and_then(|c| c.extra_large.clone().or_else(|| c.large.clone()))
                .or_else(|| media.banner_image.clone()),
            duration,
            genres: media.genres.clone(),
            seasons: Self::seasons_for(media),
            dubs: Vec::<AudioTrackOption>::new(),
        }
    }

    async fn post_graphql<T: for<'de> Deserialize<'de>>(
        &self,
        query: &str,
        variables: serde_json::Value,
    ) -> Result<T, ProviderError> {
        let body = serde_json::json!({
            "query": query,
            "variables": variables,
        });
        let response = self
            .http
            .post(ANILIST_ENDPOINT)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("User-Agent", "ArchlastCine/1.0 (anime-provider)")
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
            log::warn!("anime metadata: AniList HTTP {status}");
            return Err(ProviderError::Unavailable(ANIME_UNAVAILABLE.to_string()));
        }

        let parsed: GraphQlResponse<T> = response
            .json()
            .await
            .map_err(|e| ProviderError::Parsing(e.to_string()))?;

        if let Some(errors) = parsed.errors {
            if !errors.is_empty() {
                let message = errors
                    .into_iter()
                    .map(|e| e.message)
                    .collect::<Vec<_>>()
                    .join("; ");
                return Err(ProviderError::Parsing(message));
            }
        }

        parsed.data.ok_or_else(|| {
            ProviderError::Parsing("AniList response contained no data".to_string())
        })
    }

    async fn post_allanime_graphql<T: for<'de> Deserialize<'de>>(
        &self,
        query: &str,
        variables: serde_json::Value,
    ) -> Result<T, ProviderError> {
        let body = serde_json::json!({
            "query": query,
            "variables": variables,
        });
        let response = self
            .http
            .post(ALLANIME_ENDPOINT)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("User-Agent", "Mozilla/5.0 (ArchlastCine anime-provider)")
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            log::warn!("anime metadata: AllAnime HTTP {status}");
            return Err(ProviderError::Unavailable(ANIME_UNAVAILABLE.to_string()));
        }

        let parsed: AllAnimeResponse<T> = response
            .json()
            .await
            .map_err(|e| ProviderError::Parsing(e.to_string()))?;

        if let Some(errors) = parsed.errors {
            if !errors.is_empty() {
                let message = errors
                    .into_iter()
                    .map(|e| e.message)
                    .collect::<Vec<_>>()
                    .join("; ");
                return Err(ProviderError::Parsing(message));
            }
        }

        parsed.data.ok_or_else(|| {
            ProviderError::Parsing("AllAnime response contained no data".to_string())
        })
    }

    fn allanime_pick_title(card: &AllAnimeCard) -> String {
        card.english_name
            .clone()
            .or_else(|| card.name.clone())
            .unwrap_or_else(|| "Unknown Anime".to_string())
    }

    fn allanime_episodes_count(card: &AllAnimeCard) -> usize {
        card.available_episodes_detail
            .as_ref()
            .and_then(|v| v.get("sub"))
            .and_then(|v| v.as_array())
            .map(|arr| arr.len())
            .unwrap_or(0)
    }

    fn allanime_seasons_for(card: &AllAnimeCard) -> Vec<Season> {
        let count = Self::allanime_episodes_count(card);
        if count == 0 {
            return Vec::new();
        }
        let episodes = (1..=count)
            .map(|number| Episode {
                season: 1,
                number,
                title: None,
            })
            .collect();
        vec![Season {
            number: 1,
            episodes,
        }]
    }

    fn allanime_media_id(card: &AllAnimeCard) -> ProviderMediaId {
        ProviderMediaId {
            provider: ProviderKind::Anime,
            value: card.id.clone(),
        }
    }

    fn allanime_to_catalog_item(card: &AllAnimeCard) -> CatalogItem {
        CatalogItem {
            id: Self::allanime_media_id(card),
            title: Self::allanime_pick_title(card),
            media_type: MediaType::Anime,
            year: card.season.as_ref().and_then(|s| s.get("year")).and_then(|v| v.as_i64()).map(|y| y.to_string()),
            poster_url: card.thumbnail.clone().or_else(|| card.banner.clone()),
            season_count: if Self::allanime_episodes_count(card) > 1 {
                Some(1)
            } else {
                None
            },
        }
    }

    fn allanime_to_details(card: &AllAnimeCard) -> MediaDetails {
        let episodes_count = Self::allanime_episodes_count(card);
        let duration = if episodes_count > 1 {
            Some(format!("{episodes_count} episodes"))
        } else {
            None
        };
        let director = card.studios.as_ref().and_then(|s| s.first().cloned());

        MediaDetails {
            id: Self::allanime_media_id(card),
            title: Self::allanime_pick_title(card),
            media_type: MediaType::Anime,
            year: card.season.as_ref().and_then(|s| s.get("year")).and_then(|v| v.as_i64()).map(|y| y.to_string()),
            description: Self::clean_description(card.description.clone()),
            tagline: card.season.as_ref().map(|s| {
                let quarter = s.get("quarter").and_then(|v| v.as_str()).unwrap_or("");
                let year = s.get("year").and_then(|v| v.as_i64()).map(|y| format!(" {y}")).unwrap_or_default();
                format!("{quarter}{year}")
            }),
            imdb_rating: None,
            director,
            stars: None,
            prints: None,
            audios: None,
            poster_url: card.thumbnail.clone().or_else(|| card.banner.clone()),
            duration,
            genres: card.genres.clone().unwrap_or_default(),
            seasons: Self::allanime_seasons_for(card),
            dubs: Vec::<AudioTrackOption>::new(),
        }
    }



    /// Seasonal catalog: anime airing in the given season/year, most popular
    /// first. `season` is the calendar season ("winter" | "spring" |
    /// "summer" | "fall"); AniList semantics map it onto `MediaSeason`.
    pub async fn seasonal(
        &self,
        season: &str,
        year: i64,
        page: usize,
    ) -> Result<Vec<CatalogItem>, ProviderError> {
        let season_key = season.trim().to_ascii_uppercase();
        if !matches!(
            season_key.as_str(),
            "WINTER" | "SPRING" | "SUMMER" | "FALL"
        ) {
            return Err(ProviderError::Unavailable(format!(
                "invalid season: {season} (expected winter/spring/summer/fall)"
            )));
        }
        let page_data: PageData = self
            .post_graphql(
                SEASONAL_QUERY,
                serde_json::json!({
                    "page": page.max(1),
                    "perPage": 50,
                    "season": season_key,
                    "seasonYear": year,
                }),
            )
            .await?;
        Ok(page_data.media.iter().map(Self::to_catalog_item).collect())
    }

    /// Browse anime by sort order (TRENDING_DESC, POPULARITY_DESC, START_DATE_DESC).
    /// Optional status filter (e.g., "RELEASING" for currently airing).
    pub async fn browse(
        &self,
        sort: &str,
        status: Option<&str>,
        page: usize,
    ) -> Result<Vec<CatalogItem>, ProviderError> {
        let browse_query = r#"
query ($page: Int, $perPage: Int, $sort: [MediaSort], $status: MediaStatus) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, sort: $sort, status: $status) {
      id
      idMal
      title { romaji english native }
      coverImage { large }
      bannerImage
      description
      genres
      season
      seasonYear
      episodes
      status
    }
  }
}
"#;
        let mut variables = serde_json::json!({
            "page": page.max(1),
            "perPage": 50,
            "sort": [sort],
        });
        if let Some(s) = status {
            variables["status"] = serde_json::json!(s);
        }
        let page_data: PageData = match self.post_graphql(browse_query, variables.clone()).await {
            Ok(data) => data,
            Err(_) => {
                // Fallback to AllAnime for trending/popular/recent
                let allanime_data: AllAnimePopularData = self
                    .post_allanime_graphql(
                        ALLANIME_POPULAR_QUERY,
                        serde_json::json!({
                            "type": "anime",
                            "page": page.max(1),
                            "size": 50,
                            "dateRange": 7,
                        }),
                    )
                    .await?;
                let cards: Vec<CatalogItem> = allanime_data
                    .query_popular
                    .map(|p| {
                        p.recommendations
                            .iter()
                            .filter_map(|r| r.any_card.as_ref())
                            .map(Self::allanime_to_catalog_item)
                            .collect()
                    })
                    .unwrap_or_default();
                return Ok(cards);
            }
        };
        Ok(page_data.media.iter().map(Self::to_catalog_item).collect())
    }
}

impl crate::providers::Provider for AnimeProvider {
    fn id(&self) -> ProviderKind {
        ProviderKind::Anime
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_search: true,
            supports_pagination: true,
            supports_series: true,
            supports_subtitles: false,
            supports_homepage: false,
        }
    }

    async fn search(&self, query: &str, page: usize) -> Result<Vec<CatalogItem>, ProviderError> {
        let result = self
            .post_graphql::<PageData>(
                SEARCH_QUERY,
                serde_json::json!({
                    "page": page.max(1),
                    "perPage": 25,
                    "search": query,
                }),
            )
            .await;
        match result {
            Ok(page_data) => Ok(page_data.media.iter().map(Self::to_catalog_item).collect()),
            Err(_) => {
                // Fallback to AllAnime search
                let allanime_data: AllAnimeSearchData = self
                    .post_allanime_graphql(
                        ALLANIME_SEARCH_QUERY,
                        serde_json::json!({
                            "q": query,
                            "page": page.max(1),
                            "limit": 25,
                        }),
                    )
                    .await?;
                let cards: Vec<CatalogItem> = allanime_data
                    .shows
                    .map(|s| s.edges.iter().map(Self::allanime_to_catalog_item).collect())
                    .unwrap_or_default();
                Ok(cards)
            }
        }
    }

    async fn details(&self, id: &str) -> Result<MediaDetails, ProviderError> {
        // Try AniList first (numeric ID)
        if let Ok(anilist_id) = id.trim().parse::<i64>() {
            if let Ok(media) = self
                .post_graphql::<AniListMedia>(
                    DETAILS_QUERY,
                    serde_json::json!({ "id": anilist_id }),
                )
                .await
            {
                if media.id == anilist_id {
                    return Ok(Self::to_details(&media));
                }
            }
        }
        // Fallback to AllAnime (string ID)
        let allanime_data: AllAnimeDetailsData = self
            .post_allanime_graphql(
                ALLANIME_DETAILS_QUERY,
                serde_json::json!({ "id": id }),
            )
            .await?;
        let card = allanime_data.show.ok_or(ProviderError::NotFound)?;
        Ok(Self::allanime_to_details(&card))
    }
}

impl crate::providers::ReleaseProvider for AnimeProvider {
    async fn episode_streams(
        &self,
        id: &str,
        _season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        // Try the anime resolver first (handles AA_CRYPTO via headless browser).
        let resolver_err = match self.resolver_allanime_streams(id, episode).await {
            Ok(releases) if !releases.is_empty() => return Ok(releases),
            Ok(_) => None,
            Err(e) => Some(e.to_string()),
        };

        // Fallback to direct AllAnime API (may fail without crypto).
        let direct_err = match self.allanime_episode_streams(id, episode).await {
            Ok(releases) if !releases.is_empty() => return Ok(releases),
            Ok(_) => None,
            Err(e) => Some(e.to_string()),
        };

        // Technical causes stay in server logs; the UI only sees generic copy.
        log::warn!(
            "anime episode_streams: no playable streams for id={} ep={}: resolver_err={:?} direct_err={:?}",
            id,
            episode,
            resolver_err,
            direct_err
        );
        Err(ProviderError::Unavailable(ANIME_UNAVAILABLE.to_string()))
    }
}

impl AnimeProvider {
    /// AllAnime show ids are long mixed-case alphanumeric tokens
    /// (e.g. "srGrP23qJnjsHrRYD"). Slugs ("one-piece") contain '-'
    /// and AniList ids are numeric, so neither matches.
    fn looks_like_allanime_id(show_id: &str) -> bool {
        let id = show_id.trim();
        if id.len() < 10 || id.len() > 32 {
            return false;
        }
        let mut has_letter = false;
        for c in id.chars() {
            if c.is_ascii_alphabetic() {
                has_letter = true;
            } else if !c.is_ascii_digit() {
                return false;
            }
        }
        has_letter
    }

    /// Resolve an AllAnime show id to its display title via the AllAnime
    /// details query, so the resolver can search providers by title.
    async fn allanime_title_for_id(&self, show_id: &str) -> Result<String, ProviderError> {
        let data: AllAnimeDetailsData = self
            .post_allanime_graphql(
                ALLANIME_DETAILS_QUERY,
                serde_json::json!({ "id": show_id }),
            )
            .await?;
        let card = data.show.ok_or(ProviderError::NotFound)?;
        Ok(Self::allanime_pick_title(&card))
    }

    async fn resolver_allanime_streams(&self, show_id: &str, episode: usize) -> Result<Vec<Release>, ProviderError> {
        // AllAnime ids (e.g. "srGrP23qJnjsHrRYD") fail direct episode
        // queries (Cloudflare captcha on api.allanime.day), so resolve the
        // title first and let the resolver search providers by title instead.
        if Self::looks_like_allanime_id(show_id) {
            if let Ok(title) = self.allanime_title_for_id(show_id).await {
                return self
                    .post_resolver_resolve(
                        serde_json::json!({
                            "query": title,
                            "episode": episode,
                            "mode": "sub"
                        }),
                        show_id,
                        episode,
                    )
                    .await;
            }
            // Title lookup failed; fall through to the showId path below.
        }

        // Fast path for slugs ("one-piece") and numeric ids.
        self.post_resolver_resolve(
            serde_json::json!({
                "showId": show_id,
                "episode": episode,
                "mode": "sub"
            }),
            show_id,
            episode,
        )
        .await
    }

    async fn post_resolver_resolve(
        &self,
        body: serde_json::Value,
        show_id: &str,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        let url = format!("{}/resolve", anime_resolver_url());

        // Resolver can take 17s+ (provider startup); use a dedicated long-timeout client.
        let resolver_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        let response = resolver_client.post(&url)
            .json(&body)
            .send().await
            .map_err(|e| {
                log::warn!("anime resolver unavailable for id={} ep={}: {e}", show_id, episode);
                ProviderError::Unavailable(ANIME_UNAVAILABLE.to_string())
            })?;
        if !response.status().is_success() {
            log::warn!("anime resolver HTTP {} for id={} ep={}", response.status(), show_id, episode);
            return Err(ProviderError::Unavailable(ANIME_UNAVAILABLE.to_string()));
        }

        let json: serde_json::Value = response.json().await
            .map_err(|e| ProviderError::Parsing(e.to_string()))?;
        if let Some(detail) = json.get("detail").and_then(|v| v.as_str()) {
            log::warn!("anime resolver detail for id={} ep={}: {detail}", show_id, episode);
        }
        let streams = json.get("streams").and_then(|s| s.as_array()).ok_or_else(|| {
            log::warn!("anime resolver: empty streams envelope for id={} ep={}", show_id, episode);
            ProviderError::Parsing("resolver returned no streams".to_string())
        })?;

        let mut releases = Vec::new();
        for stream in streams {
            if let Some(stream_url) = stream.get("url").and_then(|v| v.as_str()) {
                let quality = stream.get("quality").and_then(|v| v.as_str()).unwrap_or("auto").to_string();
                let provider = stream.get("provider").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                let referrer = stream
                    .get("referrer")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("https://allanime.day/")
                    .to_string();

                releases.push(Release {
                    provider: ProviderKind::Anime,
                    filename: format!("{}-ep{}", show_id, episode),
                    quality: Some(quality),
                    codec: None,
                    language: Some("Japanese".to_string()),
                    size_bytes: None,
                    season: Some(1),
                    episode: Some(episode),
                    resource_id: Some(format!("scraper-{}-{}", show_id, episode)),
                    mirrors: vec![crate::providers::models::SourceMirror {
                        label: format!("Anime ({})", provider),
                        resolver_url: stream_url.to_string(),
                        headers: vec![
                            ("Referer".to_string(), referrer),
                            ("User-Agent".to_string(), "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string()),
                        ],
                        direct_file: true,
                    }],
                });
            }
        }

        Ok(releases)
    }

    async fn allanime_episode_streams(&self, show_id: &str, episode: usize) -> Result<Vec<Release>, ProviderError> {
        let variables = serde_json::json!({
            "showId": show_id,
            "translationType": "sub",
            "episodeString": episode.to_string(),
        });
        let extensions = serde_json::json!({
            "persistedQuery": {
                "version": 1,
                "sha256Hash": ALLANIME_PERSISTED_QUERY_HASH,
            }
        });

        let url = format!(
            "{}?variables={}&extensions={}",
            ALLANIME_API_ENDPOINT,
            urlencoding::encode(&variables.to_string()),
            urlencoding::encode(&extensions.to_string())
        );

        let response = self.http.get(&url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0")
            .header("Referer", "https://youtu-chan.com")
            .header("Origin", "https://youtu-chan.com")
            .send().await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        let mut json: serde_json::Value = if response.status().is_success() {
            response.json().await.map_err(|e| ProviderError::Parsing(e.to_string()))?
        } else {
            serde_json::json!({})
        };

        // Fallback to POST if persisted query returned empty data
        let data = json.get("data");
        let has_sources = data.and_then(|d| d.get("episode")).and_then(|e| e.get("sourceUrls")).and_then(|s| s.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
        let has_tobeparsed = data.and_then(|d| d.get("tobeparsed")).and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);

        if !has_sources && !has_tobeparsed {
            let query = r#"query ($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) { episode(showId: $showId, translationType: $translationType, episodeString: $episodeString) { episodeString sourceUrls } }"#;
            let post_resp = self.http.post(ALLANIME_API_ENDPOINT)
                .header("Content-Type", "application/json")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0")
                .header("Referer", "https://allanime.to")
                .header("Origin", "https://allanime.to")
                .json(&serde_json::json!({ "query": query, "variables": variables }))
                .send().await
                .map_err(|e| ProviderError::Network(e.to_string()))?;
            
            if post_resp.status().is_success() {
                json = post_resp.json().await.map_err(|e| ProviderError::Parsing(e.to_string()))?;
            }
        }

        let mut source_urls = Vec::new();


        // Re-fetch data after potential POST fallback update
        let data = json.get("data");

        // Handle tobeparsed decryption if present
        if let Some(tobeparsed) = data.and_then(|d| d.get("tobeparsed")).and_then(|v| v.as_str()) {
            if !tobeparsed.is_empty() {
                if let Ok(decoded_sources) = self.decrypt_allanime_tobeparsed(tobeparsed) {
                    source_urls.extend(decoded_sources);
                }
            }
        }
        if let Some(sources) = data.and_then(|d| d.get("episode")).and_then(|e| e.get("sourceUrls")).and_then(|s| s.as_array()) {
            for source in sources {
                if let Some(url) = source.get("sourceUrl").and_then(|v| v.as_str()) {
                    let name = source.get("sourceName").and_then(|v| v.as_str()).unwrap_or("Default");
                    let priority = source.get("priority").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    source_urls.push((url.to_string(), name.to_string(), priority));
                }
            }
        }

        if source_urls.is_empty() {
            return Ok(Vec::new());
        }

        // Sort by priority descending
        source_urls.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

        let mut releases = Vec::new();
        for (source_url, source_name, _priority) in source_urls {
            let final_url = if source_url.starts_with("--") {
                // Decode provider path and fetch from clock.json
                let decoded_path = self.decode_allanime_provider_path(&source_url[2..])?;
                let clock_url = format!("https://allanime.day{}", decoded_path);
                
                let clock_resp = self.http.get(&clock_url)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0")
                    .header("Referer", "https://allanime.to")
                    .send().await
                    .map_err(|e| ProviderError::Network(e.to_string()))?;

                if !clock_resp.status().is_success() {
                    continue;
                }

                let clock_json: serde_json::Value = clock_resp.json().await
                    .map_err(|e| ProviderError::Parsing(e.to_string()))?;

                clock_json.get("links").and_then(|l| l.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|link| link.get("link").and_then(|v| v.as_str()))
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| source_url.clone())
            } else {
                source_url.clone()
            };

            if final_url.contains(".m3u8") || final_url.contains(".mp4") {
                releases.push(Release {
                    provider: ProviderKind::Anime,
                    filename: format!("{}-ep{}", show_id, episode),
                    quality: Some(source_name),
                    codec: None,
                    language: Some("Japanese".to_string()),
                    size_bytes: None,
                    season: Some(1),
                    episode: Some(episode),
                    resource_id: Some(format!("allanime-{}-{}", show_id, episode)),
                    mirrors: vec![crate::providers::models::SourceMirror {
                        label: "AllAnime".to_string(),
                        resolver_url: final_url,
                        headers: vec![
                            ("Referer".to_string(), "https://allanime.to".to_string()),
                            ("User-Agent".to_string(), "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0".to_string()),
                        ],
                        direct_file: true,
                    }],
                });
            }
        }

        Ok(releases)
    }

    fn decrypt_allanime_tobeparsed(&self, blob: &str) -> Result<Vec<(String, String, f64)>, ProviderError> {
        use aes::cipher::generic_array::GenericArray;
        
        let data = general_purpose::STANDARD.decode(blob)
            .map_err(|_| ProviderError::Parsing("Failed to decode tobeparsed base64".to_string()))?;

        if data.len() < 30 {
            return Ok(Vec::new());
        }

        // Key = SHA-256("Xot36i3lK3:v1")
        let mut hasher = Sha256::new();
        hasher.update(ALLANIME_CRYPTO_KEY.as_bytes());
        let key_hash = hasher.finalize();
        let key = GenericArray::from_slice(&key_hash[..32]);

        // IV construction: bytes[1:13] + counter block
        let iv_fragment = &data[1..13];
        let mut ctr_iv = [0u8; 16];
        ctr_iv[..12].copy_from_slice(iv_fragment);
        ctr_iv[12..16].copy_from_slice(&2u32.to_be_bytes());
        let nonce = GenericArray::from_slice(&ctr_iv);

        // Ciphertext: bytes[13 : len-16]
        let ct_len = data.len() - 13 - 16;
        if ct_len == 0 {
            return Ok(Vec::new());
        }
        let ciphertext = &data[13..13 + ct_len];

        let mut cipher = Aes256Ctr::new(key, nonce);
        let mut plaintext = ciphertext.to_vec();
        cipher.apply_keystream(&mut plaintext);

        let plain_str = String::from_utf8_lossy(&plaintext);
        
        // Parse decrypted JSON to extract source URLs
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&plain_str) {
            if let Some(sources) = json.get("sourceUrls").and_then(|s| s.as_array()) {
                let mut result = Vec::new();
                for source in sources {
                    if let Some(url) = source.get("sourceUrl").and_then(|v| v.as_str()) {
                        let name = source.get("sourceName").and_then(|v| v.as_str()).unwrap_or("Default");
                        let priority = source.get("priority").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        result.push((url.to_string(), name.to_string(), priority));
                    }
                }
                return Ok(result);
            }
        }

        Ok(Vec::new())
    }

    fn decode_allanime_provider_path(&self, encoded: &str) -> Result<String, ProviderError> {
        // Simple hex decode for provider paths starting with --
        let bytes = hex::decode(encoded)
            .map_err(|_| ProviderError::Parsing("Failed to decode provider path".to_string()))?;
        String::from_utf8(bytes)
            .map_err(|_| ProviderError::Parsing("Invalid UTF-8 in provider path".to_string()))
    }

    async fn senshi_episode_streams(&self, id: &str, episode: usize) -> Result<Vec<Release>, ProviderError> {
        // Senshi requires MAL ID - try to get it from AniList details
        let mal_id = self.get_mal_id_for_anime(id).await?;
        
        let url = format!("{}/episode-embeds/{}/{}", SENSHI_BASE_URL, mal_id, episode);
        
        let response = self.http.get(&url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .header("Referer", "https://senshi.live/")
            .send().await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !response.status().is_success() {
            log::warn!("anime resolver: Senshi HTTP {} for id={} ep={}", response.status(), id, episode);
            return Ok(Vec::new());
        }

        let embeds: Vec<serde_json::Value> = response.json().await
            .map_err(|e| ProviderError::Parsing(e.to_string()))?;

        let mut releases = Vec::new();
        for embed in embeds {
            let status = embed.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if status != "HardSub" && status != "Dub" {
                continue;
            }
            
            if let Some(url) = embed.get("url").and_then(|v| v.as_str()) {
                if url.contains(".m3u8") || url.contains(".mp4") {
                    releases.push(Release {
                        provider: ProviderKind::Anime,
                        filename: format!("senshi-{}-ep{}", mal_id, episode),
                        quality: Some(status.to_string()),
                        codec: None,
                        language: Some(if status == "Dub" { "English" } else { "Japanese" }.to_string()),
                        size_bytes: None,
                        season: Some(1),
                        episode: Some(episode),
                        resource_id: Some(format!("senshi-{}-{}", mal_id, episode)),
                        mirrors: vec![crate::providers::models::SourceMirror {
                            label: "Senshi".to_string(),
                            resolver_url: url.to_string(),
                            headers: vec![
                                ("Referer".to_string(), "https://senshi.live/".to_string()),
                                ("User-Agent".to_string(), "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string()),
                            ],
                            direct_file: true,
                        }],
                    });
                }
            }
        }

        Ok(releases)
    }

    async fn get_mal_id_for_anime(&self, id: &str) -> Result<i64, ProviderError> {
        // Try to parse as numeric AniList ID first
        if let Ok(anilist_id) = id.trim().parse::<i64>() {
            let media: AniListMedia = self.post_graphql(
                DETAILS_QUERY,
                serde_json::json!({ "id": anilist_id }),
            ).await?;
            
            if let Some(mal_id) = media.id_mal {
                return Ok(mal_id);
            }
        }
        
        // For AllAnime string IDs, we'd need to search AniList by title
        // For now, return error - Senshi fallback only works for AniList IDs
        Err(ProviderError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{Provider, ReleaseProvider};

    #[tokio::test]
    #[ignore = "requires network access to AniList"]
    async fn search_returns_anime_items() {
        let provider = AnimeProvider::new(Client::new());
        let results = provider.search("naruto", 1).await.unwrap();
        assert!(!results.is_empty());
        assert!(results.iter().all(|item| {
            item.media_type == MediaType::Anime && item.id.provider == ProviderKind::Anime
        }));
    }

    #[tokio::test]
    #[ignore = "requires network access to AniList"]
    async fn details_fetches_full_metadata() {
        let provider = AnimeProvider::new(Client::new());
        // AniList ID 1 = Cowboy Bebop.
        let details = provider.details("1").await.unwrap();
        assert_eq!(details.id.provider, ProviderKind::Anime);
        assert_eq!(details.media_type, MediaType::Anime);
        assert!(!details.title.is_empty());
        assert!(!details.seasons.is_empty());
    }

    #[test]
    fn allanime_id_detection_routes_ids_vs_slugs() {
        // AllAnime ID from the ticket: must take the title->query path.
        assert!(AnimeProvider::looks_like_allanime_id("srGrP23qJnjsHrRYD"));
        // Slugs contain '-' and take the showId fast path.
        assert!(!AnimeProvider::looks_like_allanime_id("one-piece"));
        assert!(!AnimeProvider::looks_like_allanime_id("naruto-shippuden"));
        // AniList numeric ids take the showId fast path.
        assert!(!AnimeProvider::looks_like_allanime_id("1"));
        assert!(!AnimeProvider::looks_like_allanime_id("21"));
    }

}
