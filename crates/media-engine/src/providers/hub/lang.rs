//! Language identification for subtitle sources. OpenSubtitles/Stremio use
//! ISO 639-2 codes (B and T variants plus a few private ones such as `pob`),
//! providers use 639-1 or native names; the player wants 639-1 and an English
//! display name.

/// A recognised language: ISO 639-1 (or BCP-47 for regional variants) code and
/// English display name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LangInfo {
    pub code: &'static str,
    pub name: &'static str,
}

/// (code, display name, lowercase aliases: 639-2/B, 639-2/T, English name, variants)
const LANGS: &[(&str, &str, &[&str])] = &[
    (
        "en",
        "English",
        &["eng", "english", "en-us", "en-gb", "en-au"],
    ),
    (
        "es",
        "Spanish",
        &[
            "spa",
            "spanish",
            "castilian",
            "es-es",
            "es-mx",
            "es-419",
            "spl",
        ],
    ),
    ("pt", "Portuguese", &["por", "portuguese", "pt-pt"]),
    (
        "pt-BR",
        "Portuguese (Brazil)",
        &["pob", "pb", "pt-br", "ptbr", "brazilian"],
    ),
    ("fr", "French", &["fre", "fra", "french", "fr-fr", "fr-ca"]),
    ("de", "German", &["ger", "deu", "german", "de-de"]),
    ("it", "Italian", &["ita", "italian"]),
    ("ru", "Russian", &["rus", "russian"]),
    ("uk", "Ukrainian", &["ukr", "ukrainian"]),
    ("pl", "Polish", &["pol", "polish"]),
    ("nl", "Dutch", &["dut", "nld", "dutch", "flemish"]),
    ("sv", "Swedish", &["swe", "swedish"]),
    ("da", "Danish", &["dan", "danish"]),
    (
        "nb",
        "Norwegian",
        &["nor", "nob", "nno", "no", "nn", "norwegian"],
    ),
    ("fi", "Finnish", &["fin", "finnish"]),
    ("cs", "Czech", &["cze", "ces", "czech"]),
    ("sk", "Slovak", &["slo", "slk", "slovak"]),
    ("hu", "Hungarian", &["hun", "hungarian"]),
    ("ro", "Romanian", &["rum", "ron", "romanian", "mo"]),
    ("bg", "Bulgarian", &["bul", "bulgarian"]),
    ("el", "Greek", &["ell", "gre", "greek"]),
    ("tr", "Turkish", &["tur", "turkish"]),
    ("he", "Hebrew", &["heb", "hebrew", "iw"]),
    ("ar", "Arabic", &["ara", "arabic"]),
    ("fa", "Persian", &["per", "fas", "persian", "farsi"]),
    ("hi", "Hindi", &["hin", "hindi"]),
    ("bn", "Bengali", &["ben", "bengali", "bangla"]),
    ("ta", "Tamil", &["tam", "tamil"]),
    ("te", "Telugu", &["tel", "telugu"]),
    ("ml", "Malayalam", &["mal", "malayalam"]),
    ("mr", "Marathi", &["mar", "marathi"]),
    ("kn", "Kannada", &["kan", "kannada"]),
    ("gu", "Gujarati", &["guj", "gujarati"]),
    ("pa", "Punjabi", &["pan", "punjabi"]),
    ("ur", "Urdu", &["urd", "urdu"]),
    ("th", "Thai", &["tha", "thai"]),
    ("vi", "Vietnamese", &["vie", "vietnamese"]),
    ("id", "Indonesian", &["ind", "indonesian", "in"]),
    ("ms", "Malay", &["may", "msa", "malay"]),
    ("tl", "Filipino", &["tgl", "fil", "filipino", "tagalog"]),
    ("ja", "Japanese", &["jpn", "japanese"]),
    ("ko", "Korean", &["kor", "korean"]),
    (
        "zh",
        "Chinese",
        &[
            "chi", "zho", "zhc", "chinese", "zh-cn", "zh-hans", "zhs", "mandarin",
        ],
    ),
    (
        "zh-TW",
        "Chinese (Traditional)",
        &["zht", "zh-tw", "zh-hant", "zh-hk", "cantonese"],
    ),
    ("sr", "Serbian", &["srp", "serbian"]),
    ("hr", "Croatian", &["hrv", "croatian"]),
    ("bs", "Bosnian", &["bos", "bosnian"]),
    ("sl", "Slovenian", &["slv", "slovenian"]),
    ("mk", "Macedonian", &["mac", "mkd", "macedonian"]),
    ("sq", "Albanian", &["alb", "sqi", "albanian"]),
    ("lt", "Lithuanian", &["lit", "lithuanian"]),
    ("lv", "Latvian", &["lav", "latvian"]),
    ("et", "Estonian", &["est", "estonian"]),
    ("is", "Icelandic", &["ice", "isl", "icelandic"]),
    ("ka", "Georgian", &["geo", "kat", "georgian"]),
    ("hy", "Armenian", &["arm", "hye", "armenian"]),
    ("az", "Azerbaijani", &["aze", "azerbaijani"]),
    ("kk", "Kazakh", &["kaz", "kazakh"]),
    ("uz", "Uzbek", &["uzb", "uzbek"]),
    ("mn", "Mongolian", &["mon", "mongolian"]),
    ("ne", "Nepali", &["nep", "nepali"]),
    ("si", "Sinhala", &["sin", "sinhala", "sinhalese"]),
    ("km", "Khmer", &["khm", "khmer"]),
    ("my", "Burmese", &["bur", "mya", "burmese"]),
    ("lo", "Lao", &["lao"]),
    ("af", "Afrikaans", &["afr", "afrikaans"]),
    ("sw", "Swahili", &["swa", "swahili"]),
    ("ca", "Catalan", &["cat", "catalan", "valencian"]),
    ("eu", "Basque", &["baq", "eus", "basque"]),
    ("gl", "Galician", &["glg", "galician"]),
    ("la", "Latin", &["lat", "latin"]),
];

/// Resolve a 639-1/639-2 code, regional tag or English name. Case/whitespace
/// insensitive, `_` and `-` equivalent. `None` for unknown input.
pub fn language_info(raw: &str) -> Option<LangInfo> {
    let key = raw.trim().to_ascii_lowercase().replace('_', "-");
    if key.is_empty() {
        return None;
    }
    let find = |k: &str| {
        LANGS
            .iter()
            .find(|(code, name, aliases)| {
                code.eq_ignore_ascii_case(k) || name.eq_ignore_ascii_case(k) || aliases.contains(&k)
            })
            .map(|(code, name, _)| LangInfo { code, name })
    };
    find(&key).or_else(|| {
        // "en-nz", "fr-be": fall back to the primary subtag.
        key.split_once('-').and_then(|(primary, _)| find(primary))
    })
}

/// Language of a provider-supplied name such as "English", "Eng. full - 5" or
/// "Рус. полные": first word checked against names/codes.
pub fn language_from_label(label: &str) -> Option<LangInfo> {
    let lower = label.trim().to_lowercase();
    let first: String = lower
        .chars()
        .take_while(|c| c.is_alphabetic() || *c == '-')
        .collect();
    language_info(&first).or_else(|| language_info(&lower))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(raw: &str) -> Option<&'static str> {
        language_info(raw).map(|l| l.code)
    }

    #[test]
    fn maps_639_2_codes_stremio_oddities_and_names() {
        assert_eq!(code("eng"), Some("en"));
        assert_eq!(code("ENG"), Some("en"));
        assert_eq!(code("pob"), Some("pt-BR"));
        assert_eq!(code("por"), Some("pt"));
        assert_eq!(code("per"), Some("fa"));
        assert_eq!(code("fas"), Some("fa"));
        assert_eq!(code("zht"), Some("zh-TW"));
        assert_eq!(code("zho"), Some("zh"));
        assert_eq!(code("chi"), Some("zh"));
        assert_eq!(code("ell"), Some("el"));
        assert_eq!(code("cze"), Some("cs"));
        assert_eq!(code("ara"), Some("ar"));
        assert_eq!(code("Spanish"), Some("es"));
        assert_eq!(code("pt_BR"), Some("pt-BR"));
        assert_eq!(code("en-NZ"), Some("en"));
        assert_eq!(code("ja"), Some("ja"));
    }

    #[test]
    fn unknown_or_blank_is_none() {
        assert_eq!(code(""), None);
        assert_eq!(code("   "), None);
        assert_eq!(code("zzz"), None);
        assert_eq!(code("toString"), None);
    }

    #[test]
    fn display_names_are_english() {
        assert_eq!(language_info("pob").unwrap().name, "Portuguese (Brazil)");
        assert_eq!(language_info("ger").unwrap().name, "German");
    }

    #[test]
    fn labels_resolve_by_first_word() {
        assert_eq!(language_from_label("English").map(|l| l.code), Some("en"));
        assert_eq!(
            language_from_label("Eng. full - 5").map(|l| l.code),
            Some("en")
        );
        assert_eq!(
            language_from_label("Spanish (Latin America)").map(|l| l.code),
            Some("es")
        );
        assert_eq!(language_from_label("whatever").map(|l| l.code), None);
    }

    #[test]
    fn table_has_no_alias_collisions() {
        let mut owner: std::collections::HashMap<String, &str> = std::collections::HashMap::new();
        for (code, name, aliases) in LANGS {
            let keys: std::collections::HashSet<String> =
                std::iter::once(code.to_ascii_lowercase())
                    .chain(std::iter::once(name.to_ascii_lowercase()))
                    .chain(aliases.iter().map(|a| a.to_string()))
                    .collect();
            for key in keys {
                if let Some(prev) = owner.insert(key.clone(), code) {
                    panic!("alias {key} claimed by both {prev} and {code}");
                }
            }
        }
    }
}
