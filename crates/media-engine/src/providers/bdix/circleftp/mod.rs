pub mod client;
pub mod parser;

pub use client::{CircleFtpClient, CircleFtpError};

use crate::providers::models::{CatalogItem, MediaDetails, ProviderError, ProviderKind, Release};
use crate::providers::{Provider, ProviderCapabilities, ReleaseProvider};

impl From<CircleFtpError> for ProviderError {
    fn from(err: CircleFtpError) -> Self {
        match err {
            CircleFtpError::Network(e) => ProviderError::Network(e.to_string()),
            CircleFtpError::Parse(p) => ProviderError::Parsing(p),
        }
    }
}

impl Provider for client::CircleFtpClient {
    fn id(&self) -> ProviderKind {
        ProviderKind::BdixCircleFtp
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

impl ReleaseProvider for client::CircleFtpClient {
    async fn episode_streams(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        self.releases(id, Some(season), Some(episode))
            .await
            .map_err(ProviderError::from)
    }
}
