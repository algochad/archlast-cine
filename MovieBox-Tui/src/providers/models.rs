use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum ProviderKind {
    #[default]
    #[serde(rename = "moviebox", alias = "movie_box")]
    MovieBox,
    #[serde(rename = "fourkhdhub", alias = "four_k_hd_hub", alias = "4khdhub")]
    FourKHdHub,
    #[serde(rename = "bdix_circleftp", alias = "bdix_circle_ftp")]
    BdixCircleFtp,
    #[serde(rename = "bdix_dhakaflix", alias = "bdix_dhaka_flix")]
    BdixDhakaFlix,
    #[serde(rename = "addons", alias = "addon")]
    Addons,
    #[serde(rename = "anime", alias = "anilist")]
    Anime,
}

impl ProviderKind {
    pub const ENABLED: [Self; 5] = [
        Self::MovieBox,
        Self::FourKHdHub,
        Self::BdixCircleFtp,
        Self::BdixDhakaFlix,
        Self::Anime,
    ];

    pub const fn cache_key(self) -> &'static str {
        match self {
            Self::MovieBox => "moviebox",
            Self::FourKHdHub => "fourkhdhub",
            Self::BdixCircleFtp => "bdix_circleftp",
            Self::BdixDhakaFlix => "bdix_dhakaflix",
            Self::Addons => "addons",
            Self::Anime => "anime",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::MovieBox => "MovieBox",
            Self::FourKHdHub => "4KHDHub",
            Self::BdixCircleFtp => "CircleFTP (BDIX)",
            Self::BdixDhakaFlix => "DhakaFlix (BDIX)",
            Self::Addons => "Addons",
            Self::Anime => "Anime",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "moviebox" => Some(Self::MovieBox),
            "4khdhub" | "fourkhdhub" => Some(Self::FourKHdHub),
            "bdix_circleftp" | "circleftp (bdix)" => Some(Self::BdixCircleFtp),
            "bdix_dhakaflix" | "dhakaflix (bdix)" => Some(Self::BdixDhakaFlix),
            "addons" | "addon" => Some(Self::Addons),
            "anime" | "anilist" => Some(Self::Anime),
            _ => None,
        }
    }

    pub const fn is_bdix(self) -> bool {
        matches!(self, Self::BdixCircleFtp | Self::BdixDhakaFlix)
    }
}

impl fmt::Display for ProviderKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProviderMediaId {
    pub provider: ProviderKind,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RequestContext {
    pub provider: ProviderKind,
    pub generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    Movie,
    Series,
    Anime,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CatalogItem {
    pub id: ProviderMediaId,
    pub title: String,
    pub media_type: MediaType,
    pub year: Option<String>,
    pub poster_url: Option<String>,
    pub season_count: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Episode {
    pub season: usize,
    pub number: usize,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Season {
    pub number: usize,
    pub episodes: Vec<Episode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioTrackOption {
    pub subject_id: String,
    pub language: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaDetails {
    pub id: ProviderMediaId,
    pub title: String,
    pub media_type: MediaType,
    pub year: Option<String>,
    pub description: Option<String>,
    pub tagline: Option<String>,
    pub imdb_rating: Option<String>,
    pub director: Option<String>,
    pub stars: Option<String>,
    pub prints: Option<String>,
    pub audios: Option<String>,
    pub poster_url: Option<String>,
    pub duration: Option<String>,
    pub genres: Vec<String>,
    pub seasons: Vec<Season>,
    pub dubs: Vec<AudioTrackOption>,
}

impl MediaDetails {
    pub fn is_series(&self) -> bool {
        self.media_type == MediaType::Series || !self.seasons.is_empty()
    }

    pub fn has_languages(&self) -> bool {
        self.dubs.len() > 1
    }

    pub fn cover_url(&self) -> Option<&str> {
        self.poster_url.as_deref()
    }

    pub fn from_search_result(
        item: &crate::models::SearchResult,
        preview: Option<&MediaDetails>,
    ) -> Self {
        if let Some(p) = preview.filter(|p| p.id.value == item.id && p.id.provider == item.provider)
        {
            let mut details = p.clone();
            if details.title.trim().is_empty() {
                details.title = item.title.clone();
            }
            if details.year.is_none() && !item.release_year.trim().is_empty() {
                details.year = Some(item.release_year.clone());
            }
            if details.poster_url.is_none() {
                details.poster_url = item.cover_url.clone();
            }
            details
        } else {
            MediaDetails {
                id: ProviderMediaId {
                    provider: item.provider,
                    value: item.id.clone(),
                },
                title: item.title.clone(),
                media_type: if item.stype == 2 {
                    MediaType::Series
                } else {
                    MediaType::Movie
                },
                year: if !item.release_year.trim().is_empty() {
                    Some(item.release_year.clone())
                } else {
                    None
                },
                description: None,
                tagline: None,
                imdb_rating: None,
                director: None,
                stars: None,
                prints: None,
                audios: None,
                poster_url: item.cover_url.clone(),
                duration: None,
                genres: vec![],
                seasons: vec![],
                dubs: vec![],
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceMirror {
    pub label: String,
    pub resolver_url: String,
    pub headers: Vec<(String, String)>,
    pub direct_file: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubtitleOption {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Release {
    pub provider: ProviderKind,
    pub filename: String,
    pub quality: Option<String>,
    pub codec: Option<String>,
    pub language: Option<String>,
    pub size_bytes: Option<u64>,
    pub season: Option<usize>,
    pub episode: Option<usize>,
    pub mirrors: Vec<SourceMirror>,
    #[serde(default)]
    pub resource_id: Option<String>,
}
impl Release {
    pub fn is_multi_resolution(&self) -> bool {
        self.quality
            .as_deref()
            .is_some_and(|q| q.eq_ignore_ascii_case("multi") || q.eq_ignore_ascii_case("multi-res"))
    }

    pub fn resolution_u64(&self) -> u64 {
        self.quality
            .as_deref()
            .and_then(|q| q.trim_end_matches('p').parse::<u64>().ok())
            .unwrap_or(1080)
    }

    pub fn resolution_i64(&self) -> i64 {
        if self.is_multi_resolution() {
            -1
        } else {
            self.resolution_u64() as i64
        }
    }
    pub fn source_label(&self) -> &str {
        self.mirrors
            .first()
            .map(|m| m.label.as_str())
            .unwrap_or_else(|| match self.provider {
                ProviderKind::FourKHdHub => "4KHDHub",
                ProviderKind::BdixCircleFtp => "CircleFTP",
                ProviderKind::BdixDhakaFlix => "DhakaFlix",
                ProviderKind::Addons => "Addon",
                ProviderKind::MovieBox => "Direct",
                ProviderKind::Anime => "AniList",
            })
    }

    pub fn direct_url(&self) -> Option<&str> {
        self.mirrors.first().map(|m| m.resolver_url.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaybackSource {
    pub provider: ProviderKind,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub subtitle: Option<String>,
    pub source_label: String,
}

impl PlaybackSource {
    pub fn bare(provider: ProviderKind, url: impl Into<String>, subtitle: Option<String>) -> Self {
        Self {
            provider,
            url: url.into(),
            headers: Vec::new(),
            subtitle,
            source_label: provider.label().to_string(),
        }
    }
}
#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderError {
    #[error("Network connection failed: {0}")]
    Network(String),
    #[error("Rate limited by provider")]
    RateLimited(Option<u64>),
    #[error("Item not found on provider")]
    NotFound,
    #[error("Failed to parse response: {0}")]
    Parsing(String),
    #[error("Provider is temporarily unavailable: {0}")]
    Unavailable(String),
}

impl ProviderError {
    pub fn user_message(&self, provider: ProviderKind) -> String {
        match self {
            Self::Network(msg) => format!("Network error on {provider}: {msg}"),
            Self::RateLimited(secs) => match secs {
                Some(s) => format!("Rate limited on {provider}. Retry in {s}s."),
                None => format!("Rate limited on {provider}."),
            },
            Self::NotFound => format!("Content not found on {provider}."),
            Self::Parsing(msg) => format!("Parser error on {provider}: {msg}"),
            Self::Unavailable(msg) => format!("{provider} unavailable: {msg}"),
        }
    }
}

impl From<String> for ProviderError {
    fn from(msg: String) -> Self {
        Self::Unavailable(msg)
    }
}

impl From<&str> for ProviderError {
    fn from(msg: &str) -> Self {
        Self::Unavailable(msg.to_string())
    }
}
