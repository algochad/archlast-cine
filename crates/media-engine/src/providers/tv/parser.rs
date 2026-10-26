use super::models::Channel;
use std::path::PathBuf;
use std::time::SystemTime;

pub struct M3UParser {
    cache_dir: PathBuf,
    client: reqwest::Client,
}

impl Default for M3UParser {
    fn default() -> Self {
        Self::new()
    }
}

impl M3UParser {
    pub fn new() -> Self {
        let cache_dir = crate::config::cache_dir().join("tv_playlists");
        std::fs::create_dir_all(&cache_dir).ok();
        let client = crate::net::http_client_builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self { cache_dir, client }
    }

    pub async fn fetch_playlist(
        &self,
        url: &str,
    ) -> Result<Vec<Channel>, Box<dyn std::error::Error>> {
        let trimmed = url.trim();
        let is_remote = crate::net::is_http_url(trimmed);
        let content = if is_remote {
            let file_path = self.cache_dir.join(cache_filename(trimmed));
            let mut needs_download = true;

            if file_path.exists() {
                if let Ok(metadata) = tokio::fs::metadata(&file_path).await {
                    if let Ok(modified) = metadata.modified() {
                        if let Ok(duration) = SystemTime::now().duration_since(modified) {
                            if duration.as_secs() < 24 * 3600 {
                                needs_download = false;
                            }
                        }
                    }
                }
            }

            if needs_download {
                let res = self
                    .client
                    .get(trimmed)
                    .send()
                    .await?
                    .error_for_status()?
                    .text()
                    .await?;
                let _ = crate::cache::atomic_write_file_async(&file_path, res.as_bytes()).await;
                res
            } else {
                match tokio::fs::read_to_string(&file_path).await {
                    Ok(content) => content,
                    Err(_) => {
                        let _ = tokio::fs::remove_file(&file_path).await;
                        self.client
                            .get(trimmed)
                            .send()
                            .await?
                            .error_for_status()?
                            .text()
                            .await?
                    }
                }
            }
        } else {
            let path = std::path::PathBuf::from(trimmed);
            tokio::fs::read_to_string(&path)
                .await
                .map_err(|error| format!("failed to read playlist file {}: {error}", trimmed))?
        };

        let channels = self.parse_m3u(&content);
        if is_remote && channels.is_empty() {
            let file_path = self.cache_dir.join(cache_filename(trimmed));
            let _ = tokio::fs::remove_file(&file_path).await;
            let fresh = self
                .client
                .get(trimmed)
                .send()
                .await?
                .error_for_status()?
                .text()
                .await?;
            let fresh_channels = self.parse_m3u(&fresh);
            if fresh_channels.is_empty() {
                return Ok(fresh_channels);
            }
            let _ = crate::cache::atomic_write_file_async(&file_path, fresh.as_bytes()).await;
            return Ok(fresh_channels);
        }
        Ok(channels)
    }

    pub fn parse_m3u(&self, content: &str) -> Vec<Channel> {
        let estimated = content.as_bytes().iter().filter(|&&b| b == b'\n').count() / 2;
        let mut channels = Vec::with_capacity(estimated.max(16));
        let mut current_channel = Channel::default();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if line.starts_with("#EXTINF:") {
                let tvg_id = extract_attr_slice(line, "tvg-id");
                if !tvg_id.is_empty() {
                    current_channel.id = tvg_id.to_string();
                }
                let tvg_logo = extract_attr_slice(line, "tvg-logo");
                if !tvg_logo.is_empty() {
                    current_channel.logo = tvg_logo.to_string();
                }
                let group_title = extract_attr_slice(line, "group-title");
                if !group_title.is_empty() {
                    current_channel.group = group_title.to_string();
                }

                if let Some(idx) = find_extinf_title_comma(line) {
                    current_channel.name = line[idx + 1..].trim().to_string();
                }
            } else if !line.starts_with('#') {
                current_channel.stream_url = line.to_string();
                if current_channel.id.is_empty() {
                    current_channel.id = current_channel.name.clone();
                }
                channels.push(std::mem::take(&mut current_channel));
            }
        }

        channels
    }
}

fn extract_attr_slice<'a>(line: &'a str, attr_name: &str) -> &'a str {
    let bytes = line.as_bytes();
    let name_bytes = attr_name.as_bytes();
    let mut i = 0;
    while i + name_bytes.len() + 2 <= bytes.len() {
        if &bytes[i..i + name_bytes.len()] == name_bytes {
            let next_byte = bytes[i + name_bytes.len()];
            if next_byte == b'=' {
                let quote = bytes[i + name_bytes.len() + 1];
                if quote == b'"' || quote == b'\'' {
                    let start = i + name_bytes.len() + 2;
                    if let Some(end_rel) = bytes[start..].iter().position(|&b| b == quote) {
                        return &line[start..start + end_rel];
                    }
                }
            }
        }
        i += 1;
    }
    ""
}

fn find_extinf_title_comma(line: &str) -> Option<usize> {
    let mut in_quote: Option<char> = None;
    for (idx, ch) in line.char_indices() {
        match in_quote {
            Some(quote) if ch == quote => in_quote = None,
            None if ch == '"' || ch == '\'' => in_quote = Some(ch),
            None if ch == ',' => return Some(idx),
            _ => {}
        }
    }
    line.find(',')
}

fn cache_filename(raw: &str) -> String {
    format!("{}.m3u", crate::cache::md5_hex(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_m3u_double_and_single_quotes() {
        let parser = M3UParser::new();
        let content = r#"#EXTM3U
#EXTINF:-1 tvg-id="cnn.us" tvg-logo="http://logo.png/cnn.png" group-title="News",CNN HD
http://example.com/cnn.m3u8
#EXTINF:-1 tvg-id='bbc.uk' tvg-logo='http://logo.png/bbc.png' group-title='News',BBC World News
http://example.com/bbc.m3u8
#EXTINF:-1,Discovery Channel
http://example.com/discovery.m3u8
"#;
        let channels = parser.parse_m3u(content);
        assert_eq!(channels.len(), 3);

        assert_eq!(channels[0].id, "cnn.us");
        assert_eq!(channels[0].name, "CNN HD");
        assert_eq!(channels[0].logo, "http://logo.png/cnn.png");
        assert_eq!(channels[0].group, "News");
        assert_eq!(channels[0].stream_url, "http://example.com/cnn.m3u8");

        assert_eq!(channels[1].id, "bbc.uk");
        assert_eq!(channels[1].name, "BBC World News");
        assert_eq!(channels[1].logo, "http://logo.png/bbc.png");
        assert_eq!(channels[1].group, "News");
        assert_eq!(channels[1].stream_url, "http://example.com/bbc.m3u8");

        assert_eq!(channels[2].id, "Discovery Channel");
        assert_eq!(channels[2].name, "Discovery Channel");
        assert_eq!(channels[2].group, "");
        assert_eq!(channels[2].stream_url, "http://example.com/discovery.m3u8");
    }

    #[test]
    fn test_parse_m3u_title_with_commas_and_quoted_attributes() {
        let parser = M3UParser::new();
        let content = r#"#EXTM3U
#EXTINF:-1 tvg-id="cnn.us" group-title="News, International",CNN, The Worldwide News Leader
http://example.com/cnn.m3u8
#EXTINF:0,Movie Channel, HD (US), 24/7
http://example.com/movie.m3u8
"#;
        let channels = parser.parse_m3u(content);
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].name, "CNN, The Worldwide News Leader");
        assert_eq!(channels[0].group, "News, International");
        assert_eq!(channels[1].name, "Movie Channel, HD (US), 24/7");
    }
}
