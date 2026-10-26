pub mod client;

pub use client::{DhakaFlixClient, DhakaFlixError};

use crate::providers::models::{CatalogItem, MediaDetails, ProviderError, ProviderKind, Release};
use crate::providers::{Provider, ProviderCapabilities, ReleaseProvider};

impl From<DhakaFlixError> for ProviderError {
    fn from(err: DhakaFlixError) -> Self {
        match err {
            DhakaFlixError::Network(e) => ProviderError::Network(e.to_string()),
            DhakaFlixError::Parse(p) => ProviderError::Parsing(p),
        }
    }
}

impl Provider for client::DhakaFlixClient {
    fn id(&self) -> ProviderKind {
        ProviderKind::BdixDhakaFlix
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_search: true,
            supports_pagination: false,
            supports_series: true,
            supports_subtitles: false,
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

impl ReleaseProvider for client::DhakaFlixClient {
    async fn episode_streams(
        &self,
        id: &str,
        _season: usize,
        _episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        self.streams(id).await.map_err(ProviderError::from)
    }
}
