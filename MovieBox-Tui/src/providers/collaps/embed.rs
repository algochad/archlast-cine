//! Parser for the Collaps embed page (`/embed/imdb/tt…`).
//!
//! The page carries no JSON API: the player config is a JS object literal
//! passed to `makePlayer({...})`. Movies put `hls:` / `audio:` / `cc:` as
//! separate JSON values inside a `source: {…}` block; series put one JSON
//! `seasons:[…]` array whose episodes carry the same three fields. Each value
//! is located by key and decoded with a streaming JSON reader that stops at
//! the end of the value, so the surrounding JS never has to parse.

use serde_json::Value;

use crate::providers::models::SubtitleOption;

/// One playable source: an HLS master plus its audio/subtitle tracks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollapsSource {
    pub hls: String,
    /// Audio track names in master-playlist order (e.g. "Eng.Original").
    pub audio: Vec<String>,
    pub subtitles: Vec<CollapsSubtitle>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollapsSubtitle {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollapsEpisode {
    pub number: usize,
    pub source: CollapsSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollapsSeason {
    pub number: usize,
    pub episodes: Vec<CollapsEpisode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollapsEmbed {
    Movie(CollapsSource),
    /// Seasons sorted ascending, episodes sorted ascending.
    Series(Vec<CollapsSeason>),
}

impl CollapsEmbed {
    /// Pick the source for a request. `season`/`episode` of 0 mean "unspecified":
    /// movies ignore them, series fall back to the first season/episode.
    pub fn source_for(&self, season: usize, episode: usize) -> Option<&CollapsSource> {
        match self {
            Self::Movie(source) => Some(source),
            Self::Series(seasons) => {
                let season = if season == 0 {
                    seasons.first()?
                } else {
                    seasons.iter().find(|s| s.number == season)?
                };
                let episode = if episode == 0 {
                    season.episodes.first()?
                } else {
                    season.episodes.iter().find(|e| e.number == episode)?
                };
                Some(&episode.source)
            }
        }
    }
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

/// Find `key:` (bare or quoted) and decode the JSON value after it. Every
/// occurrence is tried until `accept` passes, so a same-named key elsewhere in
/// the page script (e.g. `cc:3480`) is skipped.
fn json_after(haystack: &str, key: &str, accept: impl Fn(&Value) -> bool) -> Option<Value> {
    let bytes = haystack.as_bytes();
    let mut from = 0;
    while let Some(rel) = haystack[from..].find(key) {
        let start = from + rel;
        from = start + key.len();
        let quoted = start > 0 && matches!(bytes[start - 1], b'"' | b'\'');
        let key_end = if quoted { from + 1 } else { from };
        let prefix_ok = match start.checked_sub(if quoted { 2 } else { 1 }) {
            Some(i) => !is_ident_byte(bytes[i]),
            None => true,
        };
        if !prefix_ok || key_end > bytes.len() {
            continue;
        }
        if quoted && bytes.get(from) != Some(&bytes[start - 1]) {
            continue;
        }
        let rest = haystack[key_end..].trim_start();
        let Some(rest) = rest.strip_prefix(':') else {
            continue;
        };
        let mut values = serde_json::Deserializer::from_str(rest.trim_start()).into_iter::<Value>();
        if let Some(Ok(value)) = values.next() {
            if accept(&value) {
                return Some(value);
            }
        }
    }
    None
}

fn audio_names(audio: Option<&Value>) -> Vec<String> {
    audio
        .and_then(|a| a.get("names"))
        .and_then(Value::as_array)
        .map(|names| {
            names
                .iter()
                .filter_map(Value::as_str)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn subtitle_list(cc: Option<&Value>) -> Vec<CollapsSubtitle> {
    cc.and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let url = item.get("url")?.as_str()?.trim();
                    if !crate::net::is_http_url(url) {
                        return None;
                    }
                    let name = item
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Subtitles");
                    Some(CollapsSubtitle {
                        name: name.trim().to_string(),
                        url: url.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn number_of(value: Option<&Value>) -> Option<usize> {
    match value? {
        Value::Number(n) => n.as_u64().map(|n| n as usize),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn source_from(
    hls: Option<&Value>,
    audio: Option<&Value>,
    cc: Option<&Value>,
) -> Option<CollapsSource> {
    let hls = hls?.as_str()?.trim();
    if !crate::net::is_http_url(hls) {
        return None;
    }
    Some(CollapsSource {
        hls: hls.to_string(),
        audio: audio_names(audio),
        subtitles: subtitle_list(cc),
    })
}

fn parse_seasons(value: &Value) -> Vec<CollapsSeason> {
    let mut seasons: Vec<CollapsSeason> = value
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| s.get("blocked").and_then(Value::as_bool) != Some(true))
        .filter_map(|s| {
            let number = number_of(s.get("season"))?;
            let mut episodes: Vec<CollapsEpisode> = s
                .get("episodes")?
                .as_array()?
                .iter()
                .filter_map(|e| {
                    Some(CollapsEpisode {
                        number: number_of(e.get("episode"))?,
                        source: source_from(e.get("hls"), e.get("audio"), e.get("cc"))?,
                    })
                })
                .collect();
            episodes.sort_by_key(|e| e.number);
            episodes.dedup_by_key(|e| e.number);
            (!episodes.is_empty()).then_some(CollapsSeason { number, episodes })
        })
        .collect();
    seasons.sort_by_key(|s| s.number);
    seasons.dedup_by_key(|s| s.number);
    seasons
}

/// Parse an embed page. `None` when the page has no playable source.
pub fn parse_embed(html: &str) -> Option<CollapsEmbed> {
    let is_seasons = |v: &Value| {
        v.as_array()
            .is_some_and(|a| a.iter().any(|s| s.get("episodes").is_some()))
    };
    if let Some(seasons) = json_after(html, "seasons", is_seasons) {
        let seasons = parse_seasons(&seasons);
        return (!seasons.is_empty()).then_some(CollapsEmbed::Series(seasons));
    }
    let block = &html[html.find("source:")?..];
    let hls = json_after(block, "hls", Value::is_string)?;
    let audio = json_after(block, "audio", Value::is_object);
    let cc = json_after(block, "cc", Value::is_array);
    source_from(Some(&hls), audio.as_ref(), cc.as_ref()).map(CollapsEmbed::Movie)
}

/// ISO-639-1 code and English display name for a Collaps track label such as
/// "Eng. full - 5", "Рус. полные - 3" or "Укр. форсовані - 2".
pub fn track_language(name: &str) -> (&'static str, &'static str) {
    const TABLE: &[(&[&str], &str, &str)] = &[
        (&["eng", "англ"], "en", "English"),
        (&["rus", "рус"], "ru", "Russian"),
        (&["ukr", "укр"], "uk", "Ukrainian"),
        (&["spa", "исп"], "es", "Spanish"),
        (&["fre", "fra", "фран"], "fr", "French"),
        (&["ger", "deu", "нем"], "de", "German"),
        (&["ita", "итал"], "it", "Italian"),
        (&["jap", "jpn", "япон"], "ja", "Japanese"),
        (&["kor", "кор"], "ko", "Korean"),
        (&["chi", "zho", "кит"], "zh", "Chinese"),
    ];
    let lower = name.trim().to_lowercase();
    for (prefixes, code, label) in TABLE {
        if prefixes.iter().any(|p| lower.starts_with(p)) {
            return (code, label);
        }
    }
    ("und", "Unknown")
}

fn is_forced(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("форс") || lower.contains("forced")
}

/// Player-facing subtitle options for one source. Labels are English
/// ("English", "Russian (Forced)"); repeats get a running number.
pub fn subtitle_options(source: &CollapsSource) -> Vec<SubtitleOption> {
    let mut seen: Vec<String> = Vec::new();
    source
        .subtitles
        .iter()
        .map(|sub| {
            let (code, label) = track_language(&sub.name);
            let forced = is_forced(&sub.name);
            let sdh = sub.name.to_lowercase().contains("sdh");
            let base = if forced {
                format!("{label} (Forced)")
            } else {
                label.to_string()
            };
            let repeats = seen.iter().filter(|s| **s == base).count();
            seen.push(base.clone());
            let name = if repeats == 0 {
                base
            } else {
                format!("{base} {}", repeats + 1)
            };
            SubtitleOption {
                name,
                url: sub.url.clone(),
                language: (code != "und").then(|| code.to_string()),
                format: Some("vtt".to_string()),
                forced: Some(forced),
                sdh: sdh.then_some(true),
                embedded: None,
                provider: Some("collaps".to_string()),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOVIE: &str = r#"
	function makePlayer(opts) { var cc = {}; opts.cc = cc; }
		var report = { cc:3480" };
		makePlayer({
			id: 874228 ,
			source: {
				dash: "https://cdn.example/1283851.mpd?t=1",
                dasha: "https://cdn.example/alt.mpd?t=1",
				hls: "https://cdn.example/x/5K4BF6XD.mp4/master.m3u8?fckz2=a&t=1",
				audio: {"names":["Рус. Дублированный","BBC Saint-Petersburg & LHS","Eng.Original"],"order":[0,1,2]},
				cc: [{"url":"https://cdn.example/a.vtt?t=1","name":"Укр. повні - 1"},{"url":"https://cdn.example/b.vtt?t=1","name":"Рус. форсированные - 4"},{"url":"https://cdn.example/c.vtt?t=1","name":"Eng. full - 5"}]

			},
			sections: [],
		});
    "#;

    const SERIES: &str = r#"
		makePlayer({
			seasons:[{"season":2,"blocked":false,"episodes":[{"episode":"2","hls":"https://cdn.example/s2e2.m3u8","audio":{"names":["LostFilm","Eng.Original"]},"cc":[]},{"episode":"1","hls":"https://cdn.example/s2e1.m3u8","cc":[{"url":"https://cdn.example/s2e1.vtt","name":"Eng. full - 2"}]}]},{"season":1,"episodes":[{"episode":1,"hls":"https://cdn.example/s1e1.m3u8"}]},{"season":3,"blocked":true,"episodes":[{"episode":"1","hls":"https://cdn.example/s3e1.m3u8"}]}],
		});
    "#;

    #[test]
    fn parses_movie_source_audio_and_subtitles() {
        let CollapsEmbed::Movie(src) = parse_embed(MOVIE).expect("movie") else {
            panic!("expected movie");
        };
        assert_eq!(
            src.hls,
            "https://cdn.example/x/5K4BF6XD.mp4/master.m3u8?fckz2=a&t=1"
        );
        assert_eq!(
            src.audio,
            [
                "Рус. Дублированный",
                "BBC Saint-Petersburg & LHS",
                "Eng.Original"
            ]
        );
        assert_eq!(src.subtitles.len(), 3);
        assert_eq!(src.subtitles[2].url, "https://cdn.example/c.vtt?t=1");
    }

    #[test]
    fn parses_series_sorted_and_skips_blocked() {
        let CollapsEmbed::Series(seasons) = parse_embed(SERIES).expect("series") else {
            panic!("expected series");
        };
        assert_eq!(seasons.iter().map(|s| s.number).collect::<Vec<_>>(), [1, 2]);
        assert_eq!(
            seasons[1]
                .episodes
                .iter()
                .map(|e| e.number)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert_eq!(seasons[1].episodes[0].source.subtitles.len(), 1);
        assert_eq!(
            seasons[1].episodes[1].source.audio,
            ["LostFilm", "Eng.Original"]
        );
    }

    #[test]
    fn source_for_picks_requested_or_first_episode() {
        let embed = parse_embed(SERIES).unwrap();
        assert_eq!(
            embed.source_for(2, 2).unwrap().hls,
            "https://cdn.example/s2e2.m3u8"
        );
        assert_eq!(
            embed.source_for(0, 0).unwrap().hls,
            "https://cdn.example/s1e1.m3u8"
        );
        assert_eq!(
            embed.source_for(2, 0).unwrap().hls,
            "https://cdn.example/s2e1.m3u8"
        );
        assert!(embed.source_for(3, 1).is_none());
        assert!(embed.source_for(2, 9).is_none());
        let movie = parse_embed(MOVIE).unwrap();
        assert!(movie.source_for(1, 1).is_some());
    }

    #[test]
    fn page_without_source_is_none() {
        assert!(parse_embed("<html><body>Not found</body></html>").is_none());
        assert!(parse_embed("source: { dash: \"https://x/a.mpd\" }").is_none());
        assert!(parse_embed("source: { hls: \"javascript:alert(1)\" }").is_none());
    }

    #[test]
    fn json_after_respects_key_boundaries() {
        let html = r#"hlsNativeQuality: "x", xhls: "nope", hls: "https://ok""#;
        assert_eq!(
            json_after(html, "hls", Value::is_string).unwrap(),
            "https://ok"
        );
        let quoted = r#"{"seasons":[{"episodes":[]}]}"#;
        assert!(json_after(quoted, "seasons", Value::is_array).is_some());
    }

    #[test]
    fn maps_track_languages() {
        assert_eq!(track_language("Eng. full - 5"), ("en", "English"));
        assert_eq!(track_language("Eng.Original"), ("en", "English"));
        assert_eq!(track_language("Рус. полные - 3"), ("ru", "Russian"));
        assert_eq!(track_language("Укр. форсовані - 2"), ("uk", "Ukrainian"));
        assert_eq!(track_language("AlexFilm"), ("und", "Unknown"));
    }

    #[test]
    fn subtitle_options_label_forced_and_repeats() {
        let CollapsEmbed::Movie(mut src) = parse_embed(MOVIE).unwrap() else {
            unreachable!()
        };
        src.subtitles.push(CollapsSubtitle {
            name: "Eng. SDH - 6".into(),
            url: "https://cdn.example/d.vtt".into(),
        });
        let opts = subtitle_options(&src);
        let names: Vec<&str> = opts.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(
            names,
            ["Ukrainian", "Russian (Forced)", "English", "English 2"]
        );
        assert_eq!(opts[1].forced, Some(true));
        assert_eq!(opts[2].language.as_deref(), Some("en"));
        assert_eq!(opts[3].sdh, Some(true));
        assert_eq!(opts[2].format.as_deref(), Some("vtt"));
    }
}
