use super::client::FourKHdHubError;
use reqwest::Url;
use scraper::{Html, Selector};
use std::net::IpAddr;
use std::sync::LazyLock;

static SEL_DOWNLOAD: LazyLock<Selector> = LazyLock::new(|| {
    Selector::parse("a#download, a.btn-primary, a.btn-success, a.btn[href*='/download/'], a[href*='/download/'], a[href*='gamerxyt.com'], a[href*='hubcloud.php']").unwrap()
});
static SEL_LINKS: LazyLock<Selector> = LazyLock::new(|| Selector::parse("a[href]").unwrap());

pub async fn resolve(
    client: &reqwest::Client,
    drive_url: &str,
) -> Result<Vec<(String, String, Vec<(String, String)>)>, FourKHdHubError> {
    validate_resolver_url(drive_url)?;
    let drive_html = client
        .get(drive_url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let resolver_url = {
        let document = Html::parse_document(&drive_html);
        document
            .select(&SEL_DOWNLOAD)
            .filter_map(|node| node.value().attr("href"))
            .find(|href| href.starts_with("https://"))
            .map(str::to_string)
            .ok_or_else(|| FourKHdHubError::Parse("HubCloud resolver link missing".into()))?
    };

    let resolver_html = client
        .get(&resolver_url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let resolver = Html::parse_document(&resolver_html);

    let mut candidates = extract_script_pixeldrain_urls(&resolver_html)
        .into_iter()
        .map(|url| (score(&url, "PixelDrain"), url, "PixelDrain".to_string()))
        .collect::<Vec<_>>();
    candidates.extend(
        resolver
            .select(&SEL_LINKS)
            .filter_map(|node| {
                let href = node.value().attr("href")?;
                let label = node.text().collect::<String>();
                if let Some(unwrapped) = unwrap_watch_online_url(href)
                    && let Ok(valid) = validate_playback_url(&unwrapped)
                {
                    return Some((
                        score(&valid, "Watch Online"),
                        valid,
                        "Watch Online".to_string(),
                    ));
                }
                validate_playback_url(href).ok().map(|url| {
                    let url = pixeldrain_api_url(&url).unwrap_or(url);
                    (score(&url, &label), url, clean_label(&label))
                })
            })
            .collect::<Vec<_>>(),
    );
    candidates.sort_by_key(|candidate| candidate.0);
    let mut resolved = candidates
        .into_iter()
        .map(|(_, url, label)| (url, label, Vec::new()))
        .collect::<Vec<_>>();
    resolved.dedup_by(|left, right| left.0 == right.0);
    if resolved.is_empty() {
        Err(FourKHdHubError::NoPlayableMirror(
            "no candidates found".into(),
        ))
    } else {
        Ok(resolved)
    }
}

pub async fn resolve_hubdrive(
    client: &reqwest::Client,
    drive_url: &str,
) -> Result<Vec<(String, String, Vec<(String, String)>)>, FourKHdHubError> {
    validate_hubdrive_url(drive_url)?;
    let html = client
        .get(drive_url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let hubcloud_url = extract_hubcloud_drive_url(&html)
        .ok_or_else(|| FourKHdHubError::Parse("HubDrive HubCloud mirror missing".into()))?;
    resolve(client, &hubcloud_url).await
}

fn extract_hubcloud_drive_url(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let links = Selector::parse("a[href]").ok()?;
    document.select(&links).find_map(|node| {
        let raw = node.value().attr("href")?;
        let url = Url::parse(raw).ok()?;
        let host = url.host_str()?;
        (host.contains("hubcloud.") && url.path().starts_with("/drive/")).then(|| url.to_string())
    })
}

fn unwrap_watch_online_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    if url.host_str().is_some_and(|h| h.contains("pages.dev")) {
        let b64 = url
            .query_pairs()
            .find(|(k, _)| k == "u")
            .map(|(_, v)| v.into_owned())?;
        use base64::Engine;
        let decoded_bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.as_bytes())
            .ok()?;
        let decoded_str = String::from_utf8(decoded_bytes).ok()?;
        if decoded_str.starts_with("https://") {
            return Some(decoded_str);
        }
    }
    None
}

fn extract_script_pixeldrain_urls(html: &str) -> Vec<String> {
    let mut urls = Vec::new();

    let mut search_prefix = |prefix: &str| {
        let mut remainder = html;
        while let Some(url_offset) = remainder.find(prefix) {
            let candidate = &remainder[url_offset..];
            let end = candidate
                .find(|character: char| {
                    character == '"'
                        || character == '\''
                        || character.is_whitespace()
                        || character == '<'
                        || character == '\\'
                })
                .unwrap_or(candidate.len());
            if let Some(url) = pixeldrain_api_url(&candidate[..end])
                && !urls.contains(&url)
            {
                urls.push(url);
            }
            remainder = &candidate[end..];
        }
    };

    search_prefix("https://pixeldrain.dev/u/");
    search_prefix("https://pixeldrain.com/u/");
    search_prefix("https://pixeldrain.dev/api/file/");
    search_prefix("https://pixeldrain.com/api/file/");
    urls
}

fn pixeldrain_api_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    let host = url.host_str()?;
    if !host.contains("pixeldrain.") {
        return None;
    }
    let id = if let Some(stripped) = url.path().strip_prefix("/u/") {
        stripped.trim_matches('/')
    } else {
        let stripped = url.path().strip_prefix("/api/file/")?;
        stripped.trim_matches('/')
    };
    if id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return None;
    }
    Some(format!("https://{}/api/file/{}?download", host, id))
}

fn validate_resolver_url(raw: &str) -> Result<(), FourKHdHubError> {
    let url = Url::parse(raw).map_err(|_| FourKHdHubError::InvalidUrl(raw.into()))?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https" || !host.contains("hubcloud.") || !url.path().starts_with("/drive/")
    {
        return Err(FourKHdHubError::InvalidUrl(raw.into()));
    }
    Ok(())
}

fn validate_hubdrive_url(raw: &str) -> Result<(), FourKHdHubError> {
    let url = Url::parse(raw).map_err(|_| FourKHdHubError::InvalidUrl(raw.into()))?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https" || !host.contains("hubdrive.") || !url.path().starts_with("/file/") {
        return Err(FourKHdHubError::InvalidUrl(raw.into()));
    }
    Ok(())
}

pub fn validate_playback_url(raw: &str) -> Result<String, FourKHdHubError> {
    let url =
        normalize_playback_url_str(raw).ok_or_else(|| FourKHdHubError::InvalidUrl(raw.into()))?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(FourKHdHubError::InvalidUrl(raw.into()));
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = url.path().to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".local")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| !is_public_ip(address))
        || path.ends_with(".zip")
        || path.contains("login.php")
        || path.contains("logout")
    {
        return Err(FourKHdHubError::InvalidUrl(raw.into()));
    }
    Ok(url.to_string())
}

fn normalize_playback_url_str(raw: &str) -> Option<Url> {
    if let Ok(url) = Url::parse(raw) {
        return Some(url);
    }
    let (scheme_host, rest) = {
        let idx = raw.find("://")?;
        let after_scheme = &raw[idx + 3..];
        let host_end = after_scheme
            .find(['/', '?', '#'])
            .unwrap_or(after_scheme.len());
        let host = &after_scheme[..host_end];
        if host.is_empty() || host.contains(' ') {
            return None;
        }
        (&raw[..idx + 3 + host_end], &after_scheme[host_end..])
    };

    let (path_part, query_fragment) = if let Some(pos) = rest.find(['?', '#']) {
        (&rest[..pos], &rest[pos..])
    } else {
        (rest, "")
    };

    let encoded_path = path_part
        .split('/')
        .map(|segment| {
            segment
                .split(':')
                .map(|sub| {
                    percent_encoding::utf8_percent_encode(sub, percent_encoding::NON_ALPHANUMERIC)
                        .to_string()
                })
                .collect::<Vec<_>>()
                .join(":")
        })
        .collect::<Vec<_>>()
        .join("/");

    let full = format!("{}{}{}", scheme_host, encoded_path, query_fragment);
    Url::parse(&full).ok()
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            !(address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_broadcast()
                || address.is_documentation()
                || address.is_unspecified())
        }
        IpAddr::V6(address) => {
            !(address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local())
        }
    }
}

pub fn score(url: &str, label: &str) -> u8 {
    let value = format!("{} {}", url, label).to_ascii_lowercase();
    if value.contains("cloudflarestorage.com")
        || value.contains("r2.cloudflarestorage.com")
        || value.contains("fsl server")
        || value.contains("r2.dev")
        || value.contains("workers.dev")
        || value.contains("watch online")
    {
        0
    } else if value.contains("storage.googleapis.com")
        || value.contains("hubcloud.cx/re/")
        || value.contains("hubcloud.fans/re/")
    {
        1
    } else if value.contains("pixeldrain.com")
        || value.contains("pixeldrain.dev")
        || value.contains("pixel.hubcloud.")
        || value.contains("pixeldrain")
    {
        2
    } else if value.contains("googleusercontent.com")
        || value.contains("googlevideo.com")
        || value.contains("testzip.php")
        || value.contains("vcloud.php")
        || value.contains("drive.php")
        || value.contains("gpdl.")
    {
        3
    } else {
        4
    }
}

fn clean_label(label: &str) -> String {
    let clean = label.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() {
        "Direct".into()
    } else {
        clean
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_encodes_unencoded_playback_paths() {
        let raw = "https://cdn.example.com/0:/Game of Thrones/Game.of.Thrones.S01E01.[1080p].mkv";
        let validated = validate_playback_url(raw).expect("valid url with spaces");
        assert!(validated.starts_with("https://cdn.example.com/0:/Game%20of%20Thrones/"));
        assert!(validated.ends_with(".mkv"));
    }

    #[test]
    fn rejects_invalid_and_insecure_playback_urls() {
        assert!(validate_playback_url("http://insecure.com/file.mkv").is_err());
        assert!(validate_playback_url("https://localhost/file.mkv").is_err());
        assert!(validate_playback_url("https://127.0.0.1/file.mkv").is_err());
        assert!(validate_playback_url("https://192.168.1.100/file.mkv").is_err());
        assert!(validate_playback_url("https://example.com/archive.zip").is_err());
        assert!(validate_playback_url("https://example.com/login.php").is_err());
    }

    #[test]
    fn scores_mirrors_by_priority() {
        assert_eq!(
            score(
                "https://c357acb6.r2.cloudflarestorage.com/file.mkv",
                "FSL Server"
            ),
            0
        );
        assert_eq!(
            score("https://worker.sub.workers.dev/file.mkv", "Cloudflare"),
            0
        );
        assert_eq!(
            score("https://storage.googleapis.com/bucket/file.mkv", "Storage"),
            1
        );
        assert_eq!(
            score("https://pixeldrain.com/api/file/abc?download", "PixelDrain"),
            2
        );
        assert_eq!(
            score("https://hubcloud.cx/testzip.php?id=123", "Fast Direct"),
            3
        );
        assert_eq!(score("https://gpdl.example.com/stream", "Google Drive"), 3);
        assert_eq!(score("https://unknown-mirror.org/file.mkv", "Unknown"), 4);
    }
}
