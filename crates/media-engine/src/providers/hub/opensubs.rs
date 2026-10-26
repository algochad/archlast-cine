//! Keyless OpenSubtitles through Stremio's public addon. Keyed by IMDb id, it
//! serves ready-to-use UTF-8 `.srt` files for movies and single episodes in
//! dozens of languages, which makes it a universal fallback for every provider.

use reqwest::Client;
use serde_json::Value;

use super::lang::language_info;
use crate::providers::models::SubtitleOption;

const ADDON_BASE: &str = "https://opensubtitles-v3.strem.io";
/// Per-language ceiling; the player menu stays readable.
pub const PER_LANGUAGE_CAP: usize = 3;
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

fn addon_base() -> String {
    std::env::var("OPENSUBTITLES_ADDON_URL")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| ADDON_BASE.to_string())
}

/// One addon hit, before ranking.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawSub {
    pub url: String,
    pub lang: String,
    pub file_name: String,
    pub release_name: String,
    pub release_format: String,
}

/// Addon request path for a movie (`season`/`episode` `None`) or one episode.
pub fn addon_path(imdb: &str, episode: Option<(usize, usize)>) -> String {
    match episode {
        Some((season, episode)) => format!("/subtitles/series/{imdb}:{season}:{episode}.json"),
        None => format!("/subtitles/movie/{imdb}.json"),
    }
}

pub fn parse_response(body: &Value) -> Vec<RawSub> {
    let text = |item: &Value, key: &str| {
        item.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    body.get("subtitles")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let url = text(item, "url");
            let lang = text(item, "lang");
            if !crate::net::is_http_url(&url) || lang.is_empty() {
                return None;
            }
            Some(RawSub {
                url,
                lang,
                file_name: text(item, "subtitleFileName"),
                release_name: text(item, "movieReleaseName"),
                release_format: text(item, "releaseFormat"),
            })
        })
        .collect()
}

fn tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect()
}

/// Screener rips (CAM/TS/telecine) carry mistimed, low-quality subtitles.
pub fn is_cam(sub: &RawSub) -> bool {
    let format = sub.release_format.to_lowercase();
    if ["cam", "telesync", "telecine", "ts", "tc", "workprint"].contains(&format.as_str()) {
        return true;
    }
    let toks = tokens(&format!("{} {}", sub.release_name, sub.file_name));
    toks.iter().any(|t| {
        matches!(
            t.as_str(),
            "cam" | "hdcam" | "camrip" | "telesync" | "hdts" | "telecine" | "hdtc" | "workprint"
        )
    }) || toks
        .windows(2)
        .any(|w| w[0] == "hd" && matches!(w[1].as_str(), "ts" | "tc" | "cam"))
}

/// Hearing-impaired variants are labelled separately.
pub fn is_sdh(sub: &RawSub) -> bool {
    tokens(&sub.file_name)
        .iter()
        .any(|t| matches!(t.as_str(), "sdh" | "hi" | "cc" | "hearing"))
}

/// Rank, dedupe and label addon hits: at most [`PER_LANGUAGE_CAP`] per
/// language, best first (non-CAM before CAM, API order otherwise), with one
/// slot kept for a hearing-impaired variant when the language has one.
pub fn build_options(raw: Vec<RawSub>) -> Vec<SubtitleOption> {
    struct Entry {
        sub: RawSub,
        sdh: bool,
        cam: bool,
        order: usize,
    }
    // language code -> (display name, entries); insertion order = first sighting
    let mut languages: Vec<(String, String, Vec<Entry>)> = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();
    for (order, sub) in raw.into_iter().enumerate() {
        if !seen_urls.insert(sub.url.clone()) {
            continue;
        }
        let (code, name) = match language_info(&sub.lang) {
            Some(info) => (info.code.to_string(), info.name.to_string()),
            None => (sub.lang.to_lowercase(), sub.lang.to_uppercase()),
        };
        let entry = Entry {
            sdh: is_sdh(&sub),
            cam: is_cam(&sub),
            sub,
            order,
        };
        match languages.iter_mut().find(|(c, _, _)| *c == code) {
            Some((_, _, entries)) => entries.push(entry),
            None => languages.push((code, name, vec![entry])),
        }
    }

    let mut out = Vec::new();
    for (code, name, mut entries) in languages {
        entries.sort_by_key(|e| (e.cam, e.order));
        let (sdh, plain): (Vec<_>, Vec<_>) = entries.into_iter().partition(|e| e.sdh);
        let mut plain = plain.into_iter();
        let mut sdh = sdh.into_iter();
        // plain, SDH, then whatever ranks next.
        let mut picked: Vec<Entry> = Vec::new();
        picked.extend(plain.next());
        picked.extend(sdh.next());
        for entry in plain.chain(sdh) {
            if picked.len() >= PER_LANGUAGE_CAP {
                break;
            }
            picked.push(entry);
        }
        picked.truncate(PER_LANGUAGE_CAP);
        for entry in picked {
            out.push(SubtitleOption {
                name: if entry.sdh {
                    format!("{name} (SDH)")
                } else {
                    name.clone()
                },
                url: entry.sub.url,
                language: Some(code.clone()),
                format: Some("srt".to_string()),
                forced: Some(false),
                sdh: entry.sdh.then_some(true),
                embedded: Some(false),
                provider: Some("opensubtitles".to_string()),
            });
        }
    }
    out
}

/// Subtitles for a movie (`episode` `None`) or one `(season, episode)`.
pub async fn fetch(
    http: &Client,
    imdb: &str,
    episode: Option<(usize, usize)>,
) -> Result<Vec<SubtitleOption>, String> {
    let url = format!("{}{}", addon_base(), addon_path(imdb, episode));
    let resp = http
        .get(&url)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("opensubtitles addon request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("opensubtitles addon HTTP {}", resp.status()));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("opensubtitles addon response unreadable: {e}"))?;
    Ok(build_options(parse_response(&body)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn raw(url: &str, lang: &str, file: &str, release: &str, format: &str) -> RawSub {
        RawSub {
            url: url.into(),
            lang: lang.into(),
            file_name: file.into(),
            release_name: release.into(),
            release_format: format.into(),
        }
    }

    #[test]
    fn builds_addon_paths() {
        assert_eq!(
            addon_path("tt1375666", None),
            "/subtitles/movie/tt1375666.json"
        );
        assert_eq!(
            addon_path("tt0944947", Some((3, 5))),
            "/subtitles/series/tt0944947:3:5.json"
        );
    }

    #[test]
    fn parses_addon_response_and_skips_bad_rows() {
        let body = json!({"subtitles": [
            {"id": "1", "url": "https://subs5.strem.io/a", "lang": "eng", "subtitleFileName": "A.srt", "movieReleaseName": "A.1080p", "releaseFormat": "BluRay"},
            {"id": "2", "url": "ftp://nope", "lang": "eng"},
            {"id": "3", "url": "https://subs5.strem.io/c", "lang": ""},
            {"id": "4", "lang": "eng"}
        ]});
        let parsed = parse_response(&body);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].url, "https://subs5.strem.io/a");
        assert_eq!(parsed[0].release_format, "BluRay");
        assert!(parse_response(&json!({})).is_empty());
    }

    #[test]
    fn detects_cam_and_sdh() {
        assert!(is_cam(&raw(
            "u",
            "eng",
            "Inception.2010.CAM.Xvid-LKRG.srt",
            "Inception.2010.CAM.Xvid-LKRG",
            "Cam"
        )));
        assert!(is_cam(&raw(
            "u",
            "eng",
            "x.srt",
            "Movie.2010.HDCAM.x264",
            ""
        )));
        assert!(is_cam(&raw(
            "u",
            "eng",
            "x.srt",
            "Movie.2010.HD.TS.x264",
            ""
        )));
        assert!(!is_cam(&raw(
            "u",
            "eng",
            "Movie.Cambridge.srt",
            "Movie.2010.1080p.BluRay",
            "BluRay"
        )));
        assert!(is_sdh(&raw("u", "eng", "Movie.2010.SDH.srt", "", "")));
        assert!(is_sdh(&raw("u", "eng", "Movie.2010.HI.srt", "", "")));
        assert!(!is_sdh(&raw("u", "eng", "Movie.2010.srt", "", "")));
    }

    #[test]
    fn ranks_caps_and_labels_per_language() {
        let mut subs = vec![raw("u-cam", "eng", "A.CAM.srt", "A.CAM", "Cam")];
        for i in 0..5 {
            subs.push(raw(
                &format!("u-en-{i}"),
                "eng",
                &format!("A.{i}.srt"),
                "A.1080p",
                "BluRay",
            ));
        }
        subs.push(raw("u-en-sdh", "eng", "A.SDH.srt", "A.1080p", "BluRay"));
        subs.push(raw("u-pt", "pob", "B.srt", "B", ""));
        subs.push(raw("u-pt", "pob", "B-dup.srt", "B", ""));
        subs.push(raw("u-zh", "zht", "C.srt", "C", ""));
        let out = build_options(subs);

        let english: Vec<_> = out
            .iter()
            .filter(|o| o.language.as_deref() == Some("en"))
            .collect();
        assert_eq!(english.len(), PER_LANGUAGE_CAP);
        assert_eq!(english[0].url, "u-en-0");
        assert_eq!(english[0].name, "English");
        assert_eq!(english[1].url, "u-en-sdh");
        assert_eq!(english[1].name, "English (SDH)");
        assert_eq!(english[1].sdh, Some(true));
        assert!(english.iter().all(|o| o.url != "u-cam"));

        let pt: Vec<_> = out
            .iter()
            .filter(|o| o.language.as_deref() == Some("pt-BR"))
            .collect();
        assert_eq!(pt.len(), 1, "same url is deduped");
        assert_eq!(pt[0].name, "Portuguese (Brazil)");
        assert!(out.iter().any(|o| o.language.as_deref() == Some("zh-TW")));
        assert!(out.iter().all(|o| o.format.as_deref() == Some("srt")
            && o.provider.as_deref() == Some("opensubtitles")));
    }

    #[test]
    fn cam_only_languages_still_get_a_track() {
        let out = build_options(vec![raw("u-cam", "eng", "A.CAM.srt", "A.CAM", "Cam")]);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn unknown_language_codes_survive_with_their_code() {
        let out = build_options(vec![raw("u", "qqq", "A.srt", "", "")]);
        assert_eq!(out[0].language.as_deref(), Some("qqq"));
        assert_eq!(out[0].name, "QQQ");
    }
}
