//! Merge subtitle lists from several sources into the one list the player
//! shows: normalised names, no duplicates, a sane number of options per
//! language, deterministic order.

use std::collections::HashSet;

use super::lang::{language_from_label, language_info};
use super::opensubs::PER_LANGUAGE_CAP;
use crate::providers::models::SubtitleOption;

/// Subtitles from one source. Groups are merged in priority order: earlier
/// groups win a tie and sort first within a language.
pub struct CaptionGroup {
    /// Recorded on options that do not name their own provider.
    pub provider: &'static str,
    pub items: Vec<SubtitleOption>,
}

struct Normalized {
    option: SubtitleOption,
    code: String,
    display: String,
    group: usize,
    order: usize,
}

fn normalize(opt: SubtitleOption, group: usize, order: usize, provider: &str) -> Normalized {
    let info = opt
        .language
        .as_deref()
        .and_then(language_info)
        .or_else(|| language_from_label(&opt.name));
    let forced = opt.forced.unwrap_or(false);
    let sdh = opt.sdh.unwrap_or(false);
    let (code, mut display) = match info {
        Some(info) => (info.code.to_string(), info.name.to_string()),
        None => {
            let name = opt.name.trim().to_string();
            let code = opt
                .language
                .clone()
                .filter(|l| !l.trim().is_empty())
                .map(|l| l.trim().to_lowercase())
                .unwrap_or_else(|| name.to_lowercase());
            (
                code,
                if name.is_empty() {
                    "Subtitles".to_string()
                } else {
                    name
                },
            )
        }
    };
    if forced && !display.to_lowercase().contains("forced") {
        display.push_str(" (Forced)");
    }
    if sdh && !display.to_lowercase().contains("sdh") {
        display.push_str(" (SDH)");
    }
    let mut option = opt;
    option.language = Some(code.clone());
    if option.provider.is_none() {
        option.provider = Some(provider.to_string());
    }
    Normalized {
        option,
        code,
        display,
        group,
        order,
    }
}

/// Merge `groups` (see [`CaptionGroup`]).
pub fn merge_captions(groups: Vec<CaptionGroup>) -> Vec<SubtitleOption> {
    let mut all: Vec<Normalized> = Vec::new();
    for (g, group) in groups.into_iter().enumerate() {
        let provider = group.provider;
        let mut seen_in_group = HashSet::new();
        for (order, opt) in group.items.into_iter().enumerate() {
            let n = normalize(opt, g, order, provider);
            // Providers repeat identical tracks (MovieBox lists "English" four
            // times): same language, label, format and flags collapse to one.
            let key = (
                n.code.clone(),
                n.display.to_lowercase(),
                n.option.format.clone().unwrap_or_default().to_lowercase(),
                n.option.forced.unwrap_or(false),
                n.option.sdh.unwrap_or(false),
            );
            if seen_in_group.insert(key) {
                all.push(n);
            }
        }
    }

    // Exact URL duplicates across sources.
    let mut seen_urls = HashSet::new();
    all.retain(|n| seen_urls.insert(n.option.url.clone()));

    // Stable order: English first, then by language name; within a language
    // regular tracks before forced, then source priority, then source order.
    all.sort_by(|a, b| {
        let rank = |n: &Normalized| (n.code != "en", n.display_language().to_lowercase());
        rank(a)
            .cmp(&rank(b))
            .then(
                a.option
                    .forced
                    .unwrap_or(false)
                    .cmp(&b.option.forced.unwrap_or(false)),
            )
            .then(a.group.cmp(&b.group))
            .then(a.order.cmp(&b.order))
    });

    // Cap per (language, forced).
    let mut counts: std::collections::HashMap<(String, bool), usize> =
        std::collections::HashMap::new();
    all.retain(|n| {
        let c = counts
            .entry((n.code.clone(), n.option.forced.unwrap_or(false)))
            .or_insert(0);
        *c += 1;
        *c <= PER_LANGUAGE_CAP
    });

    // "English", "English 2", "English 3".
    let mut label_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    all.into_iter()
        .map(|mut n| {
            let count = label_counts.entry(n.display.to_lowercase()).or_insert(0);
            *count += 1;
            n.option.name = if *count == 1 {
                n.display.clone()
            } else {
                format!("{} {}", n.display, *count)
            };
            n.option
        })
        .collect()
}

impl Normalized {
    /// Display name without forced/SDH decoration, for ordering by language.
    fn display_language(&self) -> &str {
        self.display
            .split(" (Forced)")
            .next()
            .and_then(|s| s.split(" (SDH)").next())
            .unwrap_or(&self.display)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sub(name: &str, url: &str, lang: Option<&str>) -> SubtitleOption {
        SubtitleOption {
            name: name.into(),
            url: url.into(),
            language: lang.map(str::to_string),
            format: Some("srt".into()),
            forced: None,
            sdh: None,
            embedded: None,
            provider: None,
        }
    }

    fn names(out: &[SubtitleOption]) -> Vec<&str> {
        out.iter().map(|o| o.name.as_str()).collect()
    }

    #[test]
    fn collapses_provider_duplicates_but_keeps_distinct_sources() {
        let moviebox = (0..4)
            .map(|i| sub("English", &format!("mb-{i}"), Some("en")))
            .collect();
        let mut sdh = sub("English", "os-2", Some("en"));
        sdh.sdh = Some(true);
        let os = vec![sub("English", "os-1", Some("en")), sdh];
        let out = merge_captions(vec![
            CaptionGroup {
                provider: "moviebox",
                items: moviebox,
            },
            CaptionGroup {
                provider: "opensubtitles",
                items: os,
            },
        ]);
        assert_eq!(names(&out), ["English", "English 2", "English (SDH)"]);
        assert_eq!(out[0].url, "mb-0", "provider-native first");
        assert_eq!(out[0].provider.as_deref(), Some("moviebox"));
        assert_eq!(out[1].url, "os-1");
    }

    #[test]
    fn dedupes_exact_urls_across_sources() {
        let out = merge_captions(vec![
            CaptionGroup {
                provider: "a",
                items: vec![sub("English", "same", Some("en"))],
            },
            CaptionGroup {
                provider: "b",
                items: vec![
                    sub("English", "same", Some("en")),
                    sub("French", "fr", Some("fre")),
                ],
            },
        ]);
        assert_eq!(names(&out), ["English", "French"]);
        assert_eq!(out[1].language.as_deref(), Some("fr"));
    }

    #[test]
    fn normalises_names_from_codes_and_labels() {
        let out = merge_captions(vec![CaptionGroup {
            provider: "collaps",
            items: vec![
                sub("اَلْعَرَبِيَّةُ", "ar", Some("ar")),
                sub("Eng. full - 5", "en", None),
                sub("Whatever", "x", None),
            ],
        }]);
        assert_eq!(names(&out), ["English", "Arabic", "Whatever"]);
        assert_eq!(out[2].language.as_deref(), Some("whatever"));
    }

    #[test]
    fn caps_each_language_and_orders_english_first_then_alphabetically() {
        let formats = ["srt", "vtt", "ass", "ssa", "ttml"];
        let mut items: Vec<SubtitleOption> = formats
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let mut s = sub("Spanish", &format!("es-{i}"), Some("es"));
                s.format = Some((*f).into());
                s
            })
            .collect();
        items.push(sub("German", "de", Some("de")));
        items.push(sub("English", "en", Some("en")));
        let out = merge_captions(vec![CaptionGroup {
            provider: "a",
            items,
        }]);
        let langs: Vec<_> = out.iter().map(|o| o.language.clone().unwrap()).collect();
        assert_eq!(
            langs.iter().filter(|l| *l == "es").count(),
            PER_LANGUAGE_CAP
        );
        assert_eq!(langs, ["en", "de", "es", "es", "es"]);
        assert_eq!(
            names(&out),
            ["English", "German", "Spanish", "Spanish 2", "Spanish 3"]
        );
    }

    #[test]
    fn forced_tracks_sort_after_regular_and_are_capped_separately() {
        let mut forced = sub("Russian", "ru-f", Some("ru"));
        forced.forced = Some(true);
        let out = merge_captions(vec![CaptionGroup {
            provider: "collaps",
            items: vec![forced, sub("Russian", "ru", Some("ru"))],
        }]);
        assert_eq!(names(&out), ["Russian", "Russian (Forced)"]);
    }

    #[test]
    fn empty_input_is_empty() {
        assert!(merge_captions(vec![]).is_empty());
        assert!(
            merge_captions(vec![CaptionGroup {
                provider: "x",
                items: vec![]
            }])
            .is_empty()
        );
    }
}
