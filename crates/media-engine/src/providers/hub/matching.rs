//! Title identity across providers. MovieBox ships "Inception [Hindi]" and
//! "Breaking Bad [Hindi] S5", 4KHDHub "Inception", Cinemeta "Inception" with a
//! year, AniList "Solo Leveling Season 2: Arise from the Shadow". These helpers
//! reduce them to comparable keys.

use std::sync::LazyLock;

use regex::Regex;

static BRACKETS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[[^\]]*\]|\{[^}]*\}").unwrap());
static PAREN_YEAR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(\s*((?:19|20)\d{2})\s*\)").unwrap());
static PARENS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\([^)]*\)").unwrap());
static SEASON_NUM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bseason\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b|\bs(\d{1,2})\b")
        .unwrap()
});
static SEASON_NOISE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bseason\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\s+season\b|\bs\d{1,2}(?:\s*e\d{1,3})?\b|\bcomplete\s+series\b").unwrap()
});

/// Fold the common Latin accents so "Amélie" == "Amelie".
fn fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'ç' => 'c',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ñ' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ý' | 'ÿ' => 'y',
        other => other,
    }
}

/// Bracketed tag contents ("Hindi" in "Inception [Hindi]"), lowercased.
pub fn bracket_tags(title: &str) -> Vec<String> {
    BRACKETS
        .find_iter(title)
        .map(|m| {
            m.as_str()
                .trim_matches(|c| "[]{}".contains(c))
                .trim()
                .to_lowercase()
        })
        .filter(|t| !t.is_empty())
        .collect()
}

/// A language/dub variant of another entry: "Inception [Hindi]".
pub fn has_dub_tag(title: &str) -> bool {
    !bracket_tags(title).is_empty()
}

/// `(2010)` anywhere in the title.
pub fn year_in_title(title: &str) -> Option<i32> {
    PAREN_YEAR.captures(title).and_then(|c| c[1].parse().ok())
}

/// Season number a title declares ("Season 2", "2nd Season", "S5").
pub fn season_in_title(title: &str) -> Option<usize> {
    let cleaned = BRACKETS.replace_all(title, " ");
    SEASON_NUM.captures(&cleaned).and_then(|c| {
        (1..=3)
            .filter_map(|i| c.get(i))
            .find_map(|m| m.as_str().parse().ok())
    })
}

/// Title to show for a provider entry: no bracket tags, no season/quality noise.
pub fn display_title(title: &str) -> String {
    let no_brackets = BRACKETS.replace_all(title, " ");
    let no_season = SEASON_NOISE.replace_all(&no_brackets, " ");
    let collapsed = no_season.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches(|c: char| c == '-' || c == ':' || c == ' ');
    if trimmed.is_empty() {
        title.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

/// Everything before a season marker: "Solo Leveling Season 2: Arise…" ->
/// "Solo Leveling". Used to look anime up on IMDb, which has one entry for all
/// seasons.
pub fn base_title(title: &str) -> String {
    let no_brackets = BRACKETS.replace_all(title, " ");
    let no_parens = PARENS.replace_all(&no_brackets, " ");
    let cut = SEASON_NUM
        .find(&no_parens)
        .map(|m| &no_parens[..m.start()])
        .unwrap_or(&no_parens);
    let base = cut.split_whitespace().collect::<Vec<_>>().join(" ");
    let base = base
        .trim_matches(|c: char| c == '-' || c == ':' || c == ' ')
        .to_string();
    if base.is_empty() {
        display_title(title)
    } else {
        base
    }
}

/// Comparable form: lowercase, accent-folded, no tags/season/year noise, `&` ->
/// "and", punctuation dropped, leading "the" removed.
pub fn normalize_title(title: &str) -> String {
    let s = BRACKETS.replace_all(title, " ");
    let s = PARENS.replace_all(&s, " ");
    let s = SEASON_NOISE.replace_all(&s, " ");
    let s: String = s
        .to_lowercase()
        .chars()
        .map(fold)
        .map(|c| if c == '&' { ' ' } else { c })
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    // "&" was blanked above and "and" is dropped, so "A & B" == "A and B".
    let mut words: Vec<&str> = s.split_whitespace().filter(|w| *w != "and").collect();
    if words.first() == Some(&"the") && words.len() > 1 {
        words.remove(0);
    }
    words.join(" ")
}

impl From<crate::providers::models::MediaType> for Kind {
    fn from(value: crate::providers::models::MediaType) -> Self {
        use crate::providers::models::MediaType;
        match value {
            MediaType::Movie => Kind::Movie,
            MediaType::Series => Kind::Series,
            MediaType::Anime => Kind::Anime,
        }
    }
}

/// Movie-vs-series, as far as the source knows. Anime is compatible with both
/// (AniList movies and TV share one catalogue).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Movie,
    Series,
    Anime,
}

impl Kind {
    pub fn compatible(self, other: Kind) -> bool {
        self == Kind::Anime || other == Kind::Anime || self == other
    }
}

fn years_compatible(a: Option<i32>, b: Option<i32>) -> Option<i32> {
    match (a, b) {
        (Some(a), Some(b)) => {
            let d = (a - b).abs();
            (d <= 1).then_some(if d == 0 { 20 } else { 10 })
        }
        _ => Some(0),
    }
}

/// How well candidate `cand` matches the wanted title; `None` = not the same
/// title. Normalised titles must be equal; years may differ by at most one;
/// kinds must be compatible. Dub-tagged candidates score lower.
pub fn match_score(
    want_title: &str,
    want_year: Option<i32>,
    want_kind: Kind,
    cand_title: &str,
    cand_year: Option<i32>,
    cand_kind: Kind,
) -> Option<i32> {
    let wanted = normalize_title(want_title);
    if wanted.is_empty() || wanted != normalize_title(cand_title) {
        return None;
    }
    if !want_kind.compatible(cand_kind) {
        return None;
    }
    let year_bonus = years_compatible(
        want_year.or_else(|| year_in_title(want_title)),
        cand_year.or_else(|| year_in_title(cand_title)),
    )?;
    let mut score = 100 + year_bonus;
    if has_dub_tag(cand_title) {
        score -= 40;
    }
    Some(score)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_provider_noise() {
        assert_eq!(normalize_title("Inception [Hindi]"), "inception");
        assert_eq!(normalize_title("Breaking Bad [Hindi] S5"), "breaking bad");
        assert_eq!(normalize_title("Breaking Bad S05E03"), "breaking bad");
        assert_eq!(normalize_title("The Dark Knight (2008)"), "dark knight");
        assert_eq!(
            normalize_title("Spider-Man: No Way Home"),
            "spider man no way home"
        );
        assert_eq!(normalize_title("Amélie"), "amelie");
        assert_eq!(normalize_title("Tom & Jerry"), "tom jerry");
        assert_eq!(normalize_title("Tom and Jerry"), "tom jerry");
        assert_eq!(
            normalize_title("Harry Potter and the Deathly Hallows Part 2"),
            "harry potter the deathly hallows part 2"
        );
        assert_eq!(normalize_title("Money Heist Season 3"), "money heist");
        assert_eq!(
            normalize_title("My Hero Academia 2nd Season"),
            "my hero academia"
        );
        assert_eq!(normalize_title("S.W.A.T."), "s w a t");
        assert_eq!(normalize_title("  The  "), "the");
        assert_eq!(normalize_title(""), "");
    }

    #[test]
    fn keeps_titles_that_merely_contain_year_like_numbers() {
        assert_eq!(normalize_title("Blade Runner 2049"), "blade runner 2049");
        assert_eq!(normalize_title("1917"), "1917");
        assert_eq!(normalize_title("Se7en"), "se7en");
    }

    #[test]
    fn extracts_tags_years_and_seasons() {
        assert_eq!(
            bracket_tags("Inception [Hindi] [1080p]"),
            ["hindi", "1080p"]
        );
        assert!(has_dub_tag("Inception [Hindi]"));
        assert!(!has_dub_tag("Inception"));
        assert_eq!(year_in_title("Inception (2010)"), Some(2010));
        assert_eq!(year_in_title("Inception"), None);
        assert_eq!(season_in_title("Breaking Bad [Hindi] S5"), Some(5));
        assert_eq!(
            season_in_title("Solo Leveling Season 2: Arise from the Shadow"),
            Some(2)
        );
        assert_eq!(season_in_title("My Hero Academia 3rd Season"), Some(3));
        assert_eq!(season_in_title("Inception"), None);
    }

    #[test]
    fn display_and_base_titles() {
        assert_eq!(display_title("Inception [Hindi]"), "Inception");
        assert_eq!(display_title("Breaking Bad [Hindi] S5"), "Breaking Bad");
        assert_eq!(display_title("[Hindi]"), "[Hindi]");
        assert_eq!(
            base_title("Solo Leveling Season 2: Arise from the Shadow"),
            "Solo Leveling"
        );
        assert_eq!(base_title("Attack on Titan"), "Attack on Titan");
        assert_eq!(base_title("Dune: Part Two"), "Dune: Part Two");
    }

    #[test]
    fn score_requires_same_title_year_and_kind() {
        let s = |t: &str, y, k| match_score("Inception", Some(2010), Kind::Movie, t, y, k);
        assert_eq!(s("Inception", Some(2010), Kind::Movie), Some(120));
        assert_eq!(s("Inception", Some(2011), Kind::Movie), Some(110));
        assert_eq!(s("Inception", Some(2013), Kind::Movie), None);
        assert_eq!(s("Inception", None, Kind::Movie), Some(100));
        assert_eq!(s("Inception: The Cobol Job", Some(2010), Kind::Movie), None);
        assert_eq!(s("Inception", Some(2010), Kind::Series), None);
        assert_eq!(s("Inception", Some(2010), Kind::Anime), Some(120));
        let tagged = s("Inception [Hindi]", Some(2010), Kind::Movie).unwrap();
        assert!(tagged < s("Inception", Some(2010), Kind::Movie).unwrap());
    }

    #[test]
    fn score_uses_year_embedded_in_title_when_missing() {
        assert_eq!(
            match_score(
                "Inception (2010)",
                None,
                Kind::Movie,
                "Inception",
                Some(2010),
                Kind::Movie
            ),
            Some(120)
        );
        assert_eq!(
            match_score(
                "Inception (2010)",
                None,
                Kind::Movie,
                "Inception",
                Some(1999),
                Kind::Movie
            ),
            None
        );
    }
}
