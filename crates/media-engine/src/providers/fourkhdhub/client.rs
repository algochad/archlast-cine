use super::{hubcloud, parser};
use crate::providers::models::{CatalogItem, MediaDetails, PlaybackSource, ProviderKind, Release};
use reqwest::Url;

const DEFAULT_BASE_URL: &str = "https://4khdhub.one/";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(thiserror::Error, Debug)]
pub enum FourKHdHubError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("invalid provider URL: {0}")]
    InvalidUrl(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("no playable mirrors: {0}")]
    NoPlayableMirror(String),
}

#[derive(Clone)]
pub struct FourKHdHubClient {
    client: reqwest::Client,
    base_url: Url,
}

impl FourKHdHubClient {
    pub fn new() -> Result<Self, FourKHdHubError> {
        let base = std::env::var("MOVIEBOX_FOURKHDHUB_URL")
            .unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
        Self::with_base_url(&base)
    }

    pub fn with_base_url(base: &str) -> Result<Self, FourKHdHubError> {
        let base_url =
            Url::parse(base).map_err(|_| FourKHdHubError::InvalidUrl(base.to_string()))?;
        if base_url.scheme() != "https" {
            return Err(FourKHdHubError::InvalidUrl(base.to_string()));
        }
        Ok(Self {
            client: build_client(),
            base_url,
        })
    }

    pub async fn health_check(&self) -> Result<(), FourKHdHubError> {
        let response = self.client.get(self.base_url.clone()).send().await?;
        if !response.status().is_success() {
            return Err(FourKHdHubError::Parse(format!(
                "health check returned {}",
                response.status()
            )));
        }
        Ok(())
    }

    pub async fn search(&self, query: &str) -> Result<Vec<CatalogItem>, FourKHdHubError> {
        let mut url = self.base_url.clone();
        url.query_pairs_mut().append_pair("s", query);
        let html = self.fetch_text(url).await?;
        parser::parse_search(&self.base_url, &html)
    }

    pub async fn details(&self, id: &str) -> Result<MediaDetails, FourKHdHubError> {
        let url = self.provider_url(id)?;
        let html = self.fetch_text(url).await?;
        parser::parse_details(id, &html)
    }

    pub async fn releases(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, FourKHdHubError> {
        let url = self.provider_url(id)?;
        let html = self.fetch_text(url).await?;
        parser::parse_releases(&html, season, episode)
    }

    pub async fn resolve_release(
        &self,
        release: &Release,
    ) -> Result<PlaybackSource, FourKHdHubError> {
        if release.provider != ProviderKind::FourKHdHub {
            return Err(FourKHdHubError::Parse(
                "release belongs to another provider".into(),
            ));
        }
        let referer = self.base_url.as_str().trim_end_matches('/').to_string();
        let fetch_futures = release.mirrors.iter().map(|mirror| {
            let client = self.client.clone();
            let mirror_url = mirror.resolver_url.clone();
            let mirror_label = mirror.label.clone();
            let mirror_headers = mirror.headers.clone();
            async move {
                let fetch = async {
                    if mirror_url.contains("hubcloud.") {
                        hubcloud::resolve(&client, &mirror_url).await
                    } else if mirror_url.contains("hubdrive.") {
                        hubcloud::resolve_hubdrive(&client, &mirror_url).await
                    } else {
                        hubcloud::validate_playback_url(&mirror_url)
                            .map(|url| vec![(url, mirror_label, mirror_headers)])
                    }
                };
                tokio::time::timeout(std::time::Duration::from_millis(4000), fetch)
                    .await
                    .map_err(|_| {
                        FourKHdHubError::NoPlayableMirror("mirror resolver timed out".into())
                    })
                    .and_then(|res| res)
            }
        });
        let mirror_results = futures::future::join_all(fetch_futures).await;

        let mut candidates = Vec::new();
        for cand_list in mirror_results.into_iter().flatten() {
            for (url, label, headers) in cand_list {
                let score = hubcloud::score(&url, &label);
                candidates.push((score, url, label, headers));
            }
        }
        candidates.sort_by_key(|cand| cand.0);
        let mut unique_candidates = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for (_, url, label, headers) in candidates {
            if seen.insert(url.clone()) {
                unique_candidates.push((url, label, headers));
            }
        }

        if unique_candidates.is_empty() {
            return Err(FourKHdHubError::NoPlayableMirror(
                "Mirrors for this release are dead or expired on 4KHDHub. Select another release (e.g. 1080p) or press Ctrl+P for MovieBox.".into(),
            ));
        }

        for chunk in unique_candidates.chunks(3) {
            let chunk_futures = chunk.iter().map(|(url, label, headers)| {
                let this = self.clone();
                let url = url.clone();
                let label = label.clone();
                let mut merged = headers.clone();
                if !merged
                    .iter()
                    .any(|(name, _)| name.eq_ignore_ascii_case("referer"))
                {
                    merged.push(("Referer".to_string(), referer.clone()));
                }
                if !merged
                    .iter()
                    .any(|(name, _)| name.eq_ignore_ascii_case("user-agent"))
                {
                    merged.push(("User-Agent".to_string(), BROWSER_UA.to_string()));
                }
                Box::pin(async move {
                    let playable_url = this.preflight(&url, &merged).await?;
                    Ok::<_, FourKHdHubError>((playable_url, label, merged))
                })
            });
            if let Ok(((playable_url, label, headers), _)) =
                futures::future::select_ok(chunk_futures).await
            {
                log::info!(
                    "4KHDHub mirror playable: {label} ({})",
                    crate::logging::sanitize_url(&playable_url)
                );
                return Ok(PlaybackSource {
                    provider: ProviderKind::FourKHdHub,
                    url: playable_url,
                    headers,
                    subtitle: None,
                    source_label: label,
                });
            }
        }

        log::error!(
            "4KHDHub: no playable mirror for release {:?}",
            release.filename
        );
        Err(FourKHdHubError::NoPlayableMirror(
            "Mirrors for this release are dead or expired on 4KHDHub. Select another release (e.g. 1080p) or press Ctrl+P for MovieBox.".into(),
        ))
    }

    pub async fn preflight(
        &self,
        url: &str,
        headers: &[(String, String)],
    ) -> Result<String, FourKHdHubError> {
        let probe = async {
            hubcloud::validate_playback_url(url)?;
            let mut request = self
                .client
                .get(url)
                .header(reqwest::header::RANGE, "bytes=0-8191");
            for (name, value) in headers {
                request = request.header(name, value);
            }
            let response = request.send().await?.error_for_status()?;
            let mut final_url = response.url().clone();
            hubcloud::validate_playback_url(final_url.as_str())?;
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if content_type.contains("text/html")
                || content_type.contains("application/zip")
                || content_type.contains("text/plain")
            {
                let body_bytes = response.bytes().await.unwrap_or_default();
                let body_lower = String::from_utf8_lossy(&body_bytes).to_ascii_lowercase();
                if body_lower.contains("failed to extract link")
                    || body_lower.contains("token expired")
                    || body_lower.contains("file not found")
                    || body_lower.contains("404 not found")
                    || body_lower.contains("link has expired")
                    || body_lower.contains("expired")
                {
                    return Err(FourKHdHubError::NoPlayableMirror(
                        "upstream mirror reported expired file link".into(),
                    ));
                }

                let wrapped = final_url
                    .query_pairs()
                    .find(|(name, _)| name == "link")
                    .map(|(_, value)| value.into_owned())
                    .filter(|value| value.starts_with("https://"))
                    .ok_or_else(|| {
                        FourKHdHubError::NoPlayableMirror(format!(
                            "invalid media content type: {content_type}"
                        ))
                    })?;
                hubcloud::validate_playback_url(&wrapped)?;
                let mut wrapped_request = self
                    .client
                    .get(&wrapped)
                    .header(reqwest::header::RANGE, "bytes=0-8191");
                for (name, value) in headers {
                    wrapped_request = wrapped_request.header(name, value);
                }
                let wrapped_response = wrapped_request.send().await?.error_for_status()?;
                final_url = wrapped_response.url().clone();
                hubcloud::validate_playback_url(final_url.as_str())?;
                let wrapped_type = wrapped_response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if wrapped_type.contains("text/html")
                    || wrapped_type.contains("application/zip")
                    || wrapped_type.contains("text/plain")
                {
                    let wrapped_bytes = wrapped_response.bytes().await.unwrap_or_default();
                    let wrapped_lower =
                        String::from_utf8_lossy(&wrapped_bytes).to_ascii_lowercase();
                    if wrapped_lower.contains("failed to extract link")
                        || wrapped_lower.contains("token expired")
                        || wrapped_lower.contains("file not found")
                        || wrapped_lower.contains("404 not found")
                        || wrapped_lower.contains("expired")
                    {
                        return Err(FourKHdHubError::NoPlayableMirror(
                            "upstream mirror reported expired file link".into(),
                        ));
                    }
                    return Err(FourKHdHubError::NoPlayableMirror(format!(
                        "invalid wrapped media content type: {wrapped_type}"
                    )));
                }
            }
            Ok(final_url.to_string())
        };

        tokio::time::timeout(std::time::Duration::from_millis(3500), probe)
            .await
            .map_err(|_| {
                FourKHdHubError::NoPlayableMirror("mirror preflight probe timed out (3.5s)".into())
            })?
    }

    async fn fetch_text(&self, url: Url) -> Result<String, FourKHdHubError> {
        let response = self.client.get(url).send().await?.error_for_status()?;
        Ok(response.text().await?)
    }

    fn provider_url(&self, id: &str) -> Result<Url, FourKHdHubError> {
        let url = self
            .base_url
            .join(id.trim_start_matches('/'))
            .map_err(|_| FourKHdHubError::InvalidUrl(id.to_string()))?;
        if url.host_str() != self.base_url.host_str() {
            return Err(FourKHdHubError::InvalidUrl(id.to_string()));
        }
        Ok(url)
    }
}

fn build_client() -> reqwest::Client {
    crate::net::http_client_builder()
        .timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(5))
        .user_agent(BROWSER_UA)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_non_fourkhdhub_release() {
        let client = FourKHdHubClient::new().expect("client creation");
        let release = Release {
            provider: ProviderKind::MovieBox,
            filename: "test.mkv".into(),
            quality: None,
            codec: None,
            language: None,
            size_bytes: None,
            season: None,
            episode: None,
            mirrors: Vec::new(),
            resource_id: None,
        };
        assert!(client.resolve_release(&release).await.is_err());
    }

    #[test]
    fn validates_provider_url_host_matching() {
        let client = FourKHdHubClient::new().expect("client creation");
        assert!(client.provider_url("movie/inception-2010").is_ok());
        assert!(client.provider_url("https://evil.com/movie").is_err());
    }
}
