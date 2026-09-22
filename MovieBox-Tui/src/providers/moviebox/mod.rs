pub mod adapt;
pub mod client;
pub mod crypto;
pub mod session;
pub mod title;

pub use title::clean_moviebox_title;

use crate::providers::models::{CatalogItem, MediaDetails, ProviderError, ProviderKind};
use crate::providers::{Provider, ProviderCapabilities};

impl From<ScraperError> for ProviderError {
    fn from(err: ScraperError) -> Self {
        match err {
            ScraperError::Reqwest(e) => ProviderError::Network(e.to_string()),
            ScraperError::ApiStatus(429) => ProviderError::RateLimited(None),
            ScraperError::ApiStatus(404) => ProviderError::NotFound,
            ScraperError::ApiStatus(s) => ProviderError::Unavailable(format!("HTTP status {s}")),
            ScraperError::HostsExhausted => {
                ProviderError::Unavailable("All hosts exhausted".to_string())
            }
            ScraperError::Json(e) => ProviderError::Parsing(e.to_string()),
            ScraperError::MissingToken => ProviderError::Unavailable("Missing token".to_string()),
        }
    }
}

impl Provider for client::MovieBoxClient {
    fn id(&self) -> ProviderKind {
        ProviderKind::MovieBox
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_search: true,
            supports_pagination: true,
            supports_series: true,
            supports_subtitles: true,
            supports_homepage: true,
        }
    }

    async fn search(&self, query: &str, page: usize) -> Result<Vec<CatalogItem>, ProviderError> {
        let json = self
            .search(query, page)
            .await
            .map_err(ProviderError::from)?;
        Ok(adapt::moviebox_search_json_to_catalog(&json))
    }

    async fn details(&self, id: &str) -> Result<MediaDetails, ProviderError> {
        let json = self.get_details(id).await.map_err(ProviderError::from)?;
        adapt::moviebox_details_json_to_media_details(&json)
    }
}

impl crate::providers::ReleaseProvider for client::MovieBoxClient {
    async fn episode_streams(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<crate::providers::models::Release>, ProviderError> {
        let (play_info_res, resources_res) = tokio::join!(
            self.get_play_info(id, season, episode),
            self.get_resources(id, season, episode, 1, None, 5)
        );

        let upload_resource_id = resources_res.ok().and_then(|val| {
            val.get("list")
                .or_else(|| val.get("data").and_then(|d| d.get("list")))
                .and_then(|l| l.as_array())
                .and_then(|arr| arr.first())
                .and_then(|item| {
                    item.get("resourceId")
                        .or_else(|| item.get("id"))
                        .and_then(|v| {
                            if let Some(n) = v.as_i64() {
                                Some(n.to_string())
                            } else if let Some(n) = v.as_u64() {
                                Some(n.to_string())
                            } else {
                                v.as_str().map(|s| s.to_string())
                            }
                        })
                })
        });

        let json = play_info_res.map_err(ProviderError::from)?;
        let mut releases =
            adapt::moviebox_play_info_json_to_releases(&json, season, episode, self.user_agent());

        if !releases.is_empty() {
            if let Some(upload_id) = upload_resource_id {
                for rel in &mut releases {
                    rel.resource_id = Some(upload_id.clone());
                }
            }
            return Ok(releases);
        }

        let (items, _) = self
            .fetch_resource_page(id, 0, 1)
            .await
            .map_err(ProviderError::from)?;
        let mut legacy_releases = Vec::new();
        for item in items {
            let rel = adapt::moviebox_resource_item_to_release(&item);
            if (season == 0 && episode == 0)
                || (rel.season == Some(season) && rel.episode == Some(episode))
            {
                legacy_releases.push(rel);
            }
        }
        Ok(legacy_releases)
    }
}

use client::{MovieBoxClient, ScraperError};
use serde_json::{Value, json};

impl MovieBoxClient {
    pub async fn get_play_info(
        &self,
        subject_id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Value, ScraperError> {
        let path = if season == 0 && episode == 0 {
            format!(
                "/wefeed-mobile-bff/subject-api/play-info/v2?subjectId={}",
                subject_id
            )
        } else {
            format!(
                "/wefeed-mobile-bff/subject-api/play-info/v2?subjectId={}&se={}&ep={}",
                subject_id, season, episode
            )
        };
        self.get(&path).await
    }
    pub async fn search(&self, query: &str, page: usize) -> Result<Value, ScraperError> {
        let payload = json!({
            "keyword": query,
            "page": page,
            "perPage": 15,
            "subjectType": 0
        });
        self.post("/wefeed-mobile-bff/subject-api/search/v2", &payload)
            .await
    }

    pub async fn suggest(&self, query: &str) -> Result<Value, ScraperError> {
        self.search(query, 1).await
    }

    pub async fn get_details(&self, subject_id: &str) -> Result<Value, ScraperError> {
        let path = format!(
            "/wefeed-mobile-bff/subject-api/get?subjectId={}",
            subject_id
        );
        let mut details = self.get(&path).await?;

        let stype = details
            .get("subjectType")
            .and_then(|s| s.as_i64())
            .or_else(|| details.get("stype").and_then(|s| s.as_i64()))
            .unwrap_or(1);

        if stype == 2 {
            let season_path = format!(
                "/wefeed-mobile-bff/subject-api/season-info?subjectId={}",
                subject_id
            );
            if let Ok(season_info) = self.get(&season_path).await {
                if let Value::Object(ref mut map) = details {
                    map.insert("seasons".to_string(), season_info);
                }
            }
        }

        Ok(details)
    }

    pub async fn get_homepage(&self, tab_id: &str, page: usize) -> Result<Value, ScraperError> {
        let path = format!(
            "/wefeed-mobile-bff/tab-operating?page={}&tabId={}&version=",
            page, tab_id
        );
        self.get(&path).await
    }

    pub async fn get_resources(
        &self,
        subject_id: &str,
        season: usize,
        episode: usize,
        page: usize,
        resolution: Option<&str>,
        per_page: usize,
    ) -> Result<Value, ScraperError> {
        let res_param = if let Some(r) = resolution {
            if r.is_empty() {
                String::new()
            } else {
                format!("&resolution={}", r)
            }
        } else {
            String::new()
        };

        let path = if season == 0 && episode == 0 {
            format!(
                "/wefeed-mobile-bff/subject-api/resource?subjectId={}&page={}&perPage={}{}",
                subject_id, page, per_page, res_param
            )
        } else {
            format!(
                "/wefeed-mobile-bff/subject-api/resource?subjectId={}&se={}&ep={}&page={}&perPage={}{}",
                subject_id, season, episode, page, per_page, res_param
            )
        };
        self.get(&path).await
    }

    pub async fn fetch_resource_page(
        &self,
        subject_id: &str,
        resolution: u32,
        page: usize,
    ) -> Result<(Vec<Value>, Value), ScraperError> {
        let res_param = if resolution == 0 {
            String::new()
        } else {
            format!("&resolution={}", resolution)
        };

        let path = format!(
            "/wefeed-mobile-bff/subject-api/resource?subjectId={}&page={}&perPage=20{}",
            subject_id, page, res_param
        );

        let res = self.get(&path).await?;

        let items = res
            .get("list")
            .and_then(|l| l.as_array())
            .cloned()
            .unwrap_or_default();

        let pager = res.get("pager").cloned().unwrap_or_else(|| json!({}));

        Ok((items, pager))
    }

    pub async fn fetch_collection_resolutions(
        &self,
        subject_id: &str,
    ) -> Result<Vec<u32>, ScraperError> {
        let path = format!(
            "/wefeed-mobile-bff/subject-api/resource?subjectId={}&page=1&perPage=20",
            subject_id
        );
        let res = self.get(&path).await?;

        let mut resolutions = Vec::new();
        if let Some(cols) = res.get("collectionResolutions").and_then(|c| c.as_array()) {
            for col in cols {
                if let Some(r) = col.get("resolution").and_then(|v| v.as_u64()) {
                    if r > 0 {
                        resolutions.push(r as u32);
                    }
                }
            }
        }

        if resolutions.is_empty() {
            if let Some(list) = res.get("list").and_then(|l| l.as_array()) {
                for item in list {
                    if let Some(r) = item.get("resolution").and_then(|v| v.as_u64()) {
                        let res_u32 = r as u32;
                        if res_u32 > 0 && !resolutions.contains(&res_u32) {
                            resolutions.push(res_u32);
                        }
                    }
                }
            }
        }

        resolutions.sort_by(|a, b| b.cmp(a));

        if resolutions.is_empty() {
            resolutions = vec![1080, 720, 480, 360];
        }
        Ok(resolutions)
    }

    pub async fn get_ext_captions(
        &self,
        subject_id: &str,
        resource_id: &str,
    ) -> Result<Value, ScraperError> {
        let path = format!(
            "/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId={}&resourceId={}",
            subject_id, resource_id
        );
        self.get(&path).await
    }
}
