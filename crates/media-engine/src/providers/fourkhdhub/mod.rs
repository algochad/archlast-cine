mod client;
mod hubcloud;
mod parser;

pub use client::{FourKHdHubClient, FourKHdHubError};

use crate::providers::models::{CatalogItem, MediaDetails, ProviderError, ProviderKind, Release};
use crate::providers::{Provider, ProviderCapabilities, ReleaseProvider};

impl From<FourKHdHubError> for ProviderError {
    fn from(err: FourKHdHubError) -> Self {
        match err {
            FourKHdHubError::Network(e) => ProviderError::Network(e.to_string()),
            FourKHdHubError::InvalidUrl(u) => ProviderError::Parsing(format!("Invalid URL: {u}")),
            FourKHdHubError::Parse(p) => ProviderError::Parsing(p),
            FourKHdHubError::NoPlayableMirror(msg) => ProviderError::Unavailable(msg),
        }
    }
}

impl Provider for FourKHdHubClient {
    fn id(&self) -> ProviderKind {
        ProviderKind::FourKHdHub
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_search: true,
            supports_pagination: false,
            supports_series: true,
            supports_subtitles: true,
            supports_homepage: false,
        }
    }

    async fn search(&self, query: &str, _page: usize) -> Result<Vec<CatalogItem>, ProviderError> {
        self.search(query).await.map_err(ProviderError::from)
    }

    async fn details(&self, id: &str) -> Result<MediaDetails, ProviderError> {
        self.details(id).await.map_err(ProviderError::from)
    }
}

impl ReleaseProvider for FourKHdHubClient {
    async fn episode_streams(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        self.releases(id, season, episode)
            .await
            .map_err(ProviderError::from)
    }
}
