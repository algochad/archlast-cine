use super::client::FourKHdHubError;
use crate::providers::models::{
    CatalogItem, Episode, MediaDetails, MediaType, ProviderKind, ProviderMediaId, Release, Season,
    SourceMirror,
};
use reqwest::Url;
use scraper::{ElementRef, Html, Selector};
use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

static SEL_CARD: LazyLock<Selector> = LazyLock::new(|| Selector::parse("a.movie-card").unwrap());
static SEL_TITLE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".movie-card-title").unwrap());
static SEL_META: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".movie-card-meta").unwrap());
static SEL_IMG: LazyLock<Selector> = LazyLock::new(|| Selector::parse("img").unwrap());
static SEL_H1: LazyLock<Selector> = LazyLock::new(|| Selector::parse("h1").unwrap());
static SEL_CONTENT_DESC: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".content-section p.mt-4").unwrap());
static SEL_TAGLINE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".movie-tagline").unwrap());
static SEL_IMDB: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".imdb-score").unwrap());
static SEL_BADGE_A: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".badge-outline a").unwrap());
static SEL_METADATA_ITEM: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".metadata-item").unwrap());
static SEL_METADATA_LABEL: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".metadata-label").unwrap());
static SEL_METADATA_VALUE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".metadata-value").unwrap());
static SEL_EPISODE_ITEM: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse("#episodes .episode-download-item").unwrap());
static SEL_DOWNLOAD_ITEM: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".download-item").unwrap());
static SEL_EPISODE_FILE_TITLE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".episode-file-title").unwrap());
static SEL_FILE_TITLE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".file-title").unwrap());
static SEL_LINK_HREF: LazyLock<Selector> = LazyLock::new(|| Selector::parse("a[href]").unwrap());
static SEL_BADGE_SIZE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".badge-size, .badge").unwrap());

pub fn parse_search(base: &Url, html: &str) -> Result<Vec<CatalogItem>, FourKHdHubError> {
    let document = Html::parse_document(html);
    let mut items = Vec::new();

    for node in document.select(&SEL_CARD) {
        let Some(href) = node.value().attr("href") else {
            continue;
        };
        let Ok(url) = base.join(href) else { continue };
        if url.host_str() != base.host_str() {
            continue;
        }
        let item_title = text_of(node.select(&SEL_TITLE).next()).unwrap_or_default();
        if item_title.is_empty() {
            continue;
        }
        let meta_text = text_of(node.select(&SEL_META).next()).unwrap_or_default();
        let year = first_four_digit_year(&meta_text);
        let media_type = if href.contains("-series-") {
            MediaType::Series
        } else {
            MediaType::Movie
        };
        let poster_url = node
            .select(&SEL_IMG)
            .next()
            .and_then(|img| img.value().attr("src"))
            .map(str::to_string);
        items.push(CatalogItem {
            id: ProviderMediaId {
                provider: ProviderKind::FourKHdHub,
                value: url.path().to_string(),
            },
            title: item_title,
            media_type,
            year,
            poster_url,
            season_count: parse_season_count(&meta_text),
        });
    }
    Ok(items)
}

pub fn parse_details(id: &str, html: &str) -> Result<MediaDetails, FourKHdHubError> {
    let document = Html::parse_document(html);
    let raw_title = document
        .select(&SEL_H1)
        .find_map(|node| text_of(Some(node)))
        .filter(|text| !text.is_empty())
        .or_else(|| meta_content(&document, "meta[property=\"og:title\"]"))
        .ok_or_else(|| FourKHdHubError::Parse("title missing".into()))?;
    let title = strip_trailing_year(&raw_title);
    let media_type = if id.contains("-series-") {
        MediaType::Series
    } else {
        MediaType::Movie
    };
    let description = document
        .select(&SEL_CONTENT_DESC)
        .find_map(|node| text_of(Some(node)))
        .or_else(|| meta_content(&document, "meta[name=\"description\"]"));
    let tagline = document
        .select(&SEL_TAGLINE)
        .find_map(|node| text_of(Some(node)));
    let imdb_rating = document
        .select(&SEL_IMDB)
        .find_map(|node| text_of(Some(node)));
    let poster_url = meta_content(&document, "meta[property=\"og:image\"]");
    let year = find_metadata(&document, "Release:")
        .and_then(|value| first_four_digit_year(&value))
        .or_else(|| {
            find_metadata(&document, "Last Air:").and_then(|value| first_four_digit_year(&value))
        })
        .or_else(|| first_four_digit_year(&raw_title));
    let genres = document
        .select(&SEL_BADGE_A)
        .filter_map(|node| text_of(Some(node)))
        .filter(|value| is_genre(value))
        .collect();
    let seasons = parse_seasons(&document)?;

    Ok(MediaDetails {
        id: ProviderMediaId {
            provider: ProviderKind::FourKHdHub,
            value: id.to_string(),
        },
        title,
        media_type,
        year,
        description,
        tagline,
        imdb_rating,
        director: find_metadata(&document, "Director:"),
        stars: find_metadata(&document, "Stars:"),
        prints: find_metadata(&document, "Prints:").or_else(|| find_metadata(&document, "Print:")),
        audios: find_metadata(&document, "Audios:"),
        poster_url,
        duration: None,
        genres,
        seasons,
        dubs: vec![],
    })
}

pub fn parse_releases(
    html: &str,
    season: usize,
    episode: usize,
) -> Result<Vec<Release>, FourKHdHubError> {
    let document = Html::parse_document(html);
    let item_selector = if season > 0 {
        &*SEL_EPISODE_ITEM
    } else {
        &*SEL_DOWNLOAD_ITEM
    };
    let filename_selector = if season > 0 {
        &*SEL_EPISODE_FILE_TITLE
    } else {
        &*SEL_FILE_TITLE
    };
    let link_selector = &*SEL_LINK_HREF;
    let size_selector = &*SEL_BADGE_SIZE;
    let page_language =
        find_metadata(&document, "Audios:").and_then(|value| normalize_language_label(&value));
    let mut grouped: HashMap<String, Release> = HashMap::new();

    for item in document.select(item_selector) {
        let filename = text_of(item.select(filename_selector).next()).unwrap_or_default();
        if filename.is_empty() || is_archive(&filename) {
            continue;
        }
        let parsed_episode = parse_season_episode(&filename);
        if season > 0 && parsed_episode != Some((season, episode)) {
            continue;
        }
        let mirrors = item
            .select(link_selector)
            .filter_map(|link| {
                let href = link.value().attr("href")?;
                if !href.starts_with("https://") || href.contains("logout") {
                    return None;
                }
                let label = text_of(Some(link)).unwrap_or_else(|| "Source".into());
                Some(SourceMirror {
                    label,
                    resolver_url: href.to_string(),
                    headers: Vec::new(),
                    direct_file: !href.contains("hubcloud.") && !href.contains("hubdrive."),
                })
            })
            .collect::<Vec<_>>();
        if mirrors.is_empty() {
            continue;
        }
        let size_text = item
            .select(size_selector)
            .filter_map(|node| text_of(Some(node)))
            .find(|text| parse_size_bytes(text).is_some());
        let key = normalize_filename(&filename);
        let release = grouped.entry(key).or_insert_with(|| Release {
            provider: ProviderKind::FourKHdHub,
            quality: detect_quality(&filename),
            codec: detect_codec(&filename),
            language: detect_language(&filename).or_else(|| page_language.clone()),
            size_bytes: size_text.as_deref().and_then(parse_size_bytes),
            season: parsed_episode.map(|value| value.0),
            episode: parsed_episode.map(|value| value.1),
            filename: filename.clone(),
            mirrors: Vec::new(),
            resource_id: None,
        });
        for mirror in mirrors {
            if !release
                .mirrors
                .iter()
                .any(|existing| existing.resolver_url == mirror.resolver_url)
            {
                release.mirrors.push(mirror);
            }
        }
    }
    let mut releases = grouped.into_values().collect::<Vec<_>>();
    releases.sort_by(|left, right| right.quality.cmp(&left.quality));
    Ok(releases)
}

fn parse_seasons(document: &Html) -> Result<Vec<Season>, FourKHdHubError> {
    let item = &*SEL_EPISODE_ITEM;
    let title = &*SEL_EPISODE_FILE_TITLE;
    let mut seasons: BTreeMap<usize, BTreeMap<usize, Episode>> = BTreeMap::new();
    for node in document.select(item) {
        let filename = text_of(node.select(title).next()).unwrap_or_default();
        let Some((season, episode)) = parse_season_episode(&filename) else {
            continue;
        };
        seasons
            .entry(season)
            .or_default()
            .entry(episode)
            .or_insert(Episode {
                season,
                number: episode,
                title: None,
            });
    }
    Ok(seasons
        .into_iter()
        .map(|(number, episodes)| Season {
            number,
            episodes: episodes.into_values().collect(),
        })
        .collect())
}

fn text_of(node: Option<ElementRef<'_>>) -> Option<String> {
    node.map(|node| node.text().collect::<Vec<_>>().join(" "))
        .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|text| !text.is_empty())
}

fn meta_content(document: &Html, query: &str) -> Option<String> {
    let selector = Selector::parse(query).ok()?;
    document
        .select(&selector)
        .next()
        .and_then(|node| node.value().attr("content"))
        .map(str::to_string)
}

fn find_metadata(document: &Html, label: &str) -> Option<String> {
    document.select(&SEL_METADATA_ITEM).find_map(|node| {
        let current = text_of(node.select(&SEL_METADATA_LABEL).next())?;
        (current == label).then(|| text_of(node.select(&SEL_METADATA_VALUE).next()))?
    })
}

fn first_four_digit_year(value: &str) -> Option<String> {
    let year = crate::tui::text::extract_4digit_year(value);
    (!year.is_empty()).then_some(year)
}

fn is_genre(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "action"
            | "adventure"
            | "animation"
            | "comedy"
            | "crime"
            | "documentary"
            | "drama"
            | "family"
            | "fantasy"
            | "history"
            | "horror"
            | "music"
            | "mystery"
            | "romance"
            | "science fiction"
            | "sci-fi"
            | "thriller"
            | "war"
            | "western"
    )
}

fn strip_trailing_year(value: &str) -> String {
    let trimmed = value.trim();
    let bytes = trimmed.as_bytes();
    let start = match bytes.len().checked_sub(6) {
        Some(index) if trimmed.is_char_boundary(index) => index,
        _ => return trimmed.to_string(),
    };
    let is_parenthesized_year = bytes[start] == b'('
        && bytes[bytes.len() - 1] == b')'
        && bytes[start + 1..bytes.len() - 1]
            .iter()
            .all(|byte| byte.is_ascii_digit());
    if is_parenthesized_year {
        trimmed[..start].trim_end().to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_season_count(value: &str) -> Option<usize> {
    let marker = value.find('S')?;
    let suffix = &value[marker..];
    suffix
        .split(['-', ' ', '•'])
        .filter_map(|part| part.trim_start_matches('S').parse::<usize>().ok())
        .max()
}

fn parse_season_episode(value: &str) -> Option<(usize, usize)> {
    let upper = value.to_ascii_uppercase();
    let bytes = upper.as_bytes();
    for index in 0..bytes.len().saturating_sub(4) {
        if bytes[index] != b'S' {
            continue;
        }
        let Some(season_end) = bytes[index + 1..]
            .iter()
            .position(|byte| !byte.is_ascii_digit())
            .map(|offset| index + 1 + offset)
        else {
            continue;
        };
        if season_end == index + 1 || bytes.get(season_end) != Some(&b'E') {
            continue;
        }
        let episode_end = bytes[season_end + 1..]
            .iter()
            .position(|byte| !byte.is_ascii_digit())
            .map(|offset| season_end + 1 + offset)
            .unwrap_or(bytes.len());
        if episode_end == season_end + 1 {
            continue;
        }
        if let (Ok(season), Ok(episode)) = (
            upper[index + 1..season_end].parse(),
            upper[season_end + 1..episode_end].parse(),
        ) {
            return Some((season, episode));
        }
    }
    None
}

fn parse_size_bytes(value: &str) -> Option<u64> {
    let normalized = value.replace(' ', "").to_ascii_uppercase();
    for (suffix, multiplier) in [
        ("GB", 1024_u64.pow(3)),
        ("MB", 1024_u64.pow(2)),
        ("KB", 1024_u64),
    ] {
        if let Some(number) = normalized.strip_suffix(suffix)
            && let Ok(number) = number.parse::<f64>()
        {
            return Some((number * multiplier as f64) as u64);
        }
    }
    None
}

fn detect_quality(value: &str) -> Option<String> {
    ["2160p", "1080p", "720p", "480p"]
        .into_iter()
        .find(|quality| {
            value
                .to_ascii_lowercase()
                .contains(&quality.to_ascii_lowercase())
        })
        .map(str::to_string)
}

fn detect_codec(value: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    if lower.contains("av1") {
        Some("AV1".into())
    } else if lower.contains("h.265") || lower.contains("h265") || lower.contains("x265") {
        Some("H.265".into())
    } else if lower.contains("hevc") {
        Some("HEVC".into())
    } else if lower.contains("h.264") || lower.contains("h264") || lower.contains("x264") {
        Some("H.264".into())
    } else if lower.contains("remux") {
        Some("REMUX".into())
    } else {
        None
    }
}

fn detect_language(value: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();

    let lang_patterns: &[(&[&str], &str)] = &[
        (&["hindi", "hin"], "Hindi"),
        (&["english", "eng"], "English"),
        (&["tamil", "tam"], "Tamil"),
        (&["telugu", "tel"], "Telugu"),
        (&["kannada", "kan"], "Kannada"),
        (&["malayalam", "mal"], "Malayalam"),
        (&["bengali", "ben", "bangla"], "Bengali"),
        (&["marathi", "mar"], "Marathi"),
        (&["punjabi", "pan", "pun"], "Punjabi"),
        (&["gujarati", "guj"], "Gujarati"),
        (&["urdu", "urd"], "Urdu"),
        (&["japanese", "jap", "jpn"], "Japanese"),
        (&["korean", "kor"], "Korean"),
        (&["chinese", "chi", "mandarin", "cantonese"], "Chinese"),
        (&["spanish", "spa", "esp", "castilian"], "Spanish"),
        (&["french", "fre", "fra"], "French"),
        (&["german", "ger", "deu"], "German"),
        (&["italian", "ita"], "Italian"),
        (&["portuguese", "por"], "Portuguese"),
        (&["russian", "rus"], "Russian"),
        (&["arabic", "ara"], "Arabic"),
        (&["turkish", "tur"], "Turkish"),
        (&["thai"], "Thai"),
        (&["indonesian", "ind"], "Indonesian"),
        (&["vietnamese", "vie"], "Vietnamese"),
        (&["polish", "pol"], "Polish"),
        (&["dutch", "dut", "nld"], "Dutch"),
        (&["swedish", "swe"], "Swedish"),
        (&["danish", "dan"], "Danish"),
        (&["norwegian", "nor"], "Norwegian"),
        (&["finnish", "fin"], "Finnish"),
    ];

    let mut found_langs: Vec<(usize, &str)> = Vec::new();

    for (patterns, lang_name) in lang_patterns {
        for pattern in *patterns {
            let mut search_idx = 0;
            while let Some(pos) = lower[search_idx..].find(pattern) {
                let actual_pos = search_idx + pos;
                let end_pos = actual_pos + pattern.len();

                let prev_ok = actual_pos == 0
                    || lower
                        .get(..actual_pos)
                        .and_then(|s| s.chars().last())
                        .is_none_or(|c| !c.is_alphabetic());
                let next_ok = end_pos >= lower.len()
                    || lower
                        .get(end_pos..)
                        .and_then(|s| s.chars().next())
                        .is_none_or(|c| !c.is_alphabetic());

                if prev_ok && next_ok {
                    if !found_langs.iter().any(|(_, name)| *name == *lang_name) {
                        found_langs.push((actual_pos, lang_name));
                    }
                    break;
                }
                search_idx = actual_pos + 1;
            }
        }
    }

    if !found_langs.is_empty() {
        found_langs.sort_by_key(|(pos, _)| *pos);
        let joined = found_langs
            .into_iter()
            .map(|(_, name)| name)
            .collect::<Vec<_>>()
            .join(", ");
        return Some(joined);
    }

    if lower.contains("multi audio") || lower.contains("multi-audio") {
        Some("Multi Audio".into())
    } else if lower.contains("dual audio") || lower.contains("dual-audio") {
        Some("Dual Audio".into())
    } else {
        None
    }
}

fn normalize_language_label(value: &str) -> Option<String> {
    if let Some(detected) = detect_language(value) {
        return Some(detected);
    }
    let value = value
        .split(['|', '/', '+', ','])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    if value.is_empty()
        || value.len() > 80
        || matches!(
            value.to_ascii_lowercase().as_str(),
            "n/a" | "na" | "unknown"
        )
    {
        None
    } else {
        Some(value)
    }
}

fn is_archive(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.ends_with(".zip") || lower.contains("complete season") || lower.contains("season pack")
}

fn normalize_filename(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::strip_trailing_year;

    #[test]
    fn strips_parenthesized_year() {
        assert_eq!(strip_trailing_year("Movie Name (2024)"), "Movie Name");
        assert_eq!(strip_trailing_year("  X (1999)  "), "X");
    }

    #[test]
    fn keeps_non_year_suffixes() {
        assert_eq!(
            strip_trailing_year("Not A Year (20x4)"),
            "Not A Year (20x4)"
        );
        assert_eq!(strip_trailing_year("Season (Part 2)"), "Season (Part 2)");
        assert_eq!(strip_trailing_year("Short"), "Short");
    }

    #[test]
    fn never_panics_on_multibyte_titles() {
        assert_eq!(strip_trailing_year("英雄éé"), "英雄éé");
        assert_eq!(strip_trailing_year("英雄éé(2020)"), "英雄éé");
        assert_eq!(strip_trailing_year("Ünïcödé 🎬"), "Ünïcödé 🎬");
        assert_eq!(
            strip_trailing_year("アニメ タイトル (2023)"),
            "アニメ タイトル"
        );
    }

    #[test]
    fn handles_short_and_empty_input() {
        assert_eq!(strip_trailing_year(""), "");
        assert_eq!(strip_trailing_year("(2024)"), "");
        assert_eq!(strip_trailing_year("12345"), "12345");
        assert_eq!(strip_trailing_year("123456"), "123456");
    }
}
