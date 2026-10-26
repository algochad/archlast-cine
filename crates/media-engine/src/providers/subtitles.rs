//! External subtitle search for titles whose provider ships no captions (or
//! only a few languages): the keyless OpenSubtitles legacy REST API, plus a
//! fetcher that turns its gzip'd, legacy-encoded downloads into UTF-8 text.

use std::io::Read;

use reqwest::Client;
use serde::Deserialize;

use crate::providers::models::SubtitleOption;

const OPENSUBTITLES_SEARCH: &str = "https://rest.opensubtitles.org/search";
/// The legacy API accepts this literal agent without an API key.
const OPENSUBTITLES_AGENT: &str = "TemporaryUserAgent";
const OPENSUBTITLES_DOWNLOAD_HOST: &str = "dl.opensubtitles.org";
/// Where search results point the browser; the web server mounts the backend
/// under `/api/mb`.
pub const SUBTITLE_FILE_PATH: &str = "/api/mb/subtitles/file";
const MAX_RESULTS: usize = 20;
/// Real subtitle files are a few hundred KB; refuse anything absurd.
const MAX_DOWNLOAD_BYTES: usize = 8 * 1024 * 1024;

/// ISO 639-1 -> ISO 639-2/B, the code OpenSubtitles filters by.
fn opensubtitles_lang(code: &str) -> &'static str {
    match code.trim().to_ascii_lowercase().as_str() {
        "ar" => "ara",
        "bg" => "bul",
        "cs" => "cze",
        "da" => "dan",
        "de" => "ger",
        "el" => "ell",
        "es" => "spa",
        "fa" => "per",
        "fi" => "fin",
        "fr" => "fre",
        "he" => "heb",
        "hi" => "hin",
        "hu" => "hun",
        "id" => "ind",
        "it" => "ita",
        "ja" => "jpn",
        "ko" => "kor",
        "ms" => "may",
        "nl" => "dut",
        "no" => "nor",
        "pl" => "pol",
        "pt" => "por",
        "ro" => "rum",
        "ru" => "rus",
        "sv" => "swe",
        "th" => "tha",
        "tr" => "tur",
        "uk" => "ukr",
        "vi" => "vie",
        "zh" => "chi",
        _ => "eng",
    }
}

#[derive(Debug, Deserialize)]
struct OpenSubtitlesHit {
    #[serde(rename = "SubFileName", default)]
    file_name: String,
    #[serde(rename = "SubFormat", default)]
    format: String,
    #[serde(rename = "SubDownloadLink", default)]
    download_link: String,
    #[serde(rename = "ISO639", default)]
    iso639: String,
    #[serde(rename = "SubEncoding", default)]
    encoding: String,
    #[serde(rename = "SubDownloadsCnt", default)]
    downloads: String,
    #[serde(rename = "SubHearingImpaired", default)]
    hearing_impaired: String,
    #[serde(rename = "SubForeignPartsOnly", default)]
    foreign_parts_only: String,
    #[serde(rename = "SubBad", default)]
    bad: String,
}

/// Query OpenSubtitles for `title` (optionally a season/episode) in `lang`
/// (ISO 639-1). Results are ranked by download count and carry backend URLs
/// that `fetch_opensubtitles_file` serves as UTF-8.
pub async fn search_opensubtitles(
    http: &Client,
    title: &str,
    season: Option<usize>,
    episode: Option<usize>,
    lang: &str,
) -> Result<Vec<SubtitleOption>, String> {
    let query = title.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    // The legacy API requires its path parameters in alphabetical order.
    let mut url = String::from(OPENSUBTITLES_SEARCH);
    if let Some(e) = episode {
        url.push_str(&format!("/episode-{e}"));
    }
    url.push_str(&format!("/query-{}", urlencoding::encode(&query)));
    if let Some(s) = season {
        url.push_str(&format!("/season-{s}"));
    }
    let lang3 = opensubtitles_lang(lang);
    url.push_str(&format!("/sublanguageid-{lang3}"));

    let resp = http
        .get(&url)
        .header(reqwest::header::USER_AGENT, OPENSUBTITLES_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("opensubtitles request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("opensubtitles HTTP {}", resp.status()));
    }
    let mut hits: Vec<OpenSubtitlesHit> = resp
        .json()
        .await
        .map_err(|e| format!("opensubtitles response unreadable: {e}"))?;
    hits.retain(|h| h.bad != "1" && !h.download_link.is_empty());
    hits.sort_by_key(|h| std::cmp::Reverse(h.downloads.parse::<u64>().unwrap_or(0)));
    hits.truncate(MAX_RESULTS);

    Ok(hits
        .into_iter()
        .map(|h| {
            let format = match h.format.trim().to_ascii_lowercase().as_str() {
                "" => "srt".to_string(),
                f => f.to_string(),
            };
            let language = (!h.iso639.is_empty()).then(|| h.iso639.clone());
            SubtitleOption {
                name: h.file_name,
                url: format!(
                    "{SUBTITLE_FILE_PATH}?src={}&enc={}",
                    urlencoding::encode(&h.download_link),
                    urlencoding::encode(&h.encoding)
                ),
                language,
                format: Some(format),
                forced: Some(h.foreign_parts_only == "1"),
                sdh: Some(h.hearing_impaired == "1"),
                embedded: Some(false),
                provider: Some("opensubtitles".to_string()),
            }
        })
        .collect())
}

/// Download one OpenSubtitles file (`src` must be a `dl.opensubtitles.org`
/// link), gunzip it, and transcode from its declared legacy `encoding` to
/// UTF-8.
pub async fn fetch_opensubtitles_file(
    http: &Client,
    src: &str,
    encoding: &str,
) -> Result<String, String> {
    let parsed = reqwest::Url::parse(src).map_err(|e| format!("bad subtitle source: {e}"))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some(OPENSUBTITLES_DOWNLOAD_HOST) {
        return Err("subtitle source host not allowed".to_string());
    }
    let resp = http
        .get(parsed)
        .header(reqwest::header::USER_AGENT, OPENSUBTITLES_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("subtitle download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("subtitle download HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("subtitle download failed: {e}"))?;
    if bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err("subtitle file too large".to_string());
    }
    let raw = if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(&bytes[..])
            .take(MAX_DOWNLOAD_BYTES as u64)
            .read_to_end(&mut out)
            .map_err(|e| format!("subtitle gunzip failed: {e}"))?;
        out
    } else {
        bytes.to_vec()
    };
    Ok(decode_subtitle_text(&raw, encoding))
}

/// Decode subtitle bytes: BOM first, then valid UTF-8, then the declared
/// legacy encoding (default windows-1252).
fn decode_subtitle_text(raw: &[u8], declared: &str) -> String {
    if let Some((enc, bom_len)) = encoding_rs::Encoding::for_bom(raw) {
        return enc
            .decode_without_bom_handling(&raw[bom_len..])
            .0
            .into_owned();
    }
    if let Ok(text) = std::str::from_utf8(raw) {
        return text.to_string();
    }
    let enc = encoding_rs::Encoding::for_label(declared.trim().as_bytes())
        .unwrap_or(encoding_rs::WINDOWS_1252);
    enc.decode_without_bom_handling(raw).0.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_codes_map_to_opensubtitles_ids() {
        assert_eq!(opensubtitles_lang("en"), "eng");
        assert_eq!(opensubtitles_lang(" FR "), "fre");
        assert_eq!(opensubtitles_lang("zh"), "chi");
        assert_eq!(opensubtitles_lang("xx"), "eng");
    }

    #[test]
    fn decode_prefers_bom_then_utf8_then_declared_encoding() {
        assert_eq!(decode_subtitle_text(b"\xEF\xBB\xBFhi", "CP1252"), "hi");
        assert_eq!(
            decode_subtitle_text("caf\u{e9}".as_bytes(), "CP1252"),
            "caf\u{e9}"
        );
        // 0xE9 alone is invalid UTF-8; windows-1252 reads it as e-acute.
        assert_eq!(decode_subtitle_text(b"caf\xE9", "CP1252"), "caf\u{e9}");
        assert_eq!(decode_subtitle_text(b"caf\xE9", ""), "caf\u{e9}");
    }

    #[tokio::test]
    async fn file_fetch_rejects_foreign_hosts() {
        let http = Client::new();
        let err = fetch_opensubtitles_file(&http, "https://evil.example/x.gz", "UTF-8")
            .await
            .unwrap_err();
        assert!(err.contains("not allowed"));
        let err = fetch_opensubtitles_file(&http, "http://dl.opensubtitles.org/x.gz", "UTF-8")
            .await
            .unwrap_err();
        assert!(err.contains("not allowed"));
    }
}
