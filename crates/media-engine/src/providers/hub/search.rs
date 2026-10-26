//! One clean list of titles out of a cross-provider search: the same film must
//! not appear once per source, and provider-specific noise ("[Hindi]", "S5")
//! must not leak into what viewers see.

use super::matching::{Kind, display_title, has_dub_tag, normalize_title, year_in_title};
use crate::providers::models::{CatalogItem, MediaType, ProviderKind};

fn kind_of(item: &CatalogItem) -> Kind {
    item.media_type.into()
}

fn year_of(item: &CatalogItem) -> Option<i32> {
    item.year
        .as_deref()
        .and_then(|y| y.trim().get(..4))
        .and_then(|y| y.parse().ok())
        .or_else(|| year_in_title(&item.title))
}

/// Lower wins a collision. AniList entries beat Cinemeta for the same anime
/// (soft subs and per-episode resolving are better there); Cinemeta beats the
/// scraped movie sites.
fn priority(provider: ProviderKind, item: &CatalogItem) -> u8 {
    match (provider, item.media_type) {
        (ProviderKind::Anime, _) | (_, MediaType::Anime) => 0,
        (ProviderKind::Collaps, _) => 1,
        (ProviderKind::MovieBox, _) => 2,
        (ProviderKind::FourKHdHub, _) => 3,
        _ => 4,
    }
}

/// Scraped movie sites list a series one season at a time, each carrying that
/// season's year; a later year of the same show is still the same show.
const SEASON_YEAR_SPREAD: i32 = 25;

/// Is `cand` (lower priority) a duplicate of `kept`?
fn same_title(
    kept: &(ProviderKind, CatalogItem),
    cand: &(ProviderKind, CatalogItem),
    norm_kept: &str,
    norm_cand: &str,
) -> bool {
    let (a, b) = (&kept.1, &cand.1);
    if norm_kept.is_empty() || norm_kept != norm_cand {
        return false;
    }
    let (ya, yb) = (year_of(a), year_of(b));
    // Scraped sites sometimes file a show under "movie". Same title in the
    // same year as a catalog entry is the same title whatever the label says.
    let scraped = matches!(cand.0, ProviderKind::MovieBox | ProviderKind::FourKHdHub);
    let catalog = matches!(kept.0, ProviderKind::Collaps | ProviderKind::Anime);
    let relabeled = scraped
        && catalog
        && ya.is_some()
        && ya == yb
        && matches!(b.media_type, MediaType::Movie)
        && matches!(a.media_type, MediaType::Series | MediaType::Anime);
    if !relabeled && !kind_of(a).compatible(kind_of(b)) {
        return false;
    }
    let (Some(ya), Some(yb)) = (ya, yb) else {
        return true;
    };
    let scraped_series = matches!(cand.0, ProviderKind::MovieBox | ProviderKind::FourKHdHub)
        && matches!(b.media_type, MediaType::Series | MediaType::Anime);
    if scraped_series {
        return yb >= ya - 1 && yb - ya <= SEASON_YEAR_SPREAD;
    }
    (ya - yb).abs() <= 1
}

/// Drop duplicates (keeping the best-sourced copy, original order preserved)
/// and clean the displayed title of scraped-site entries.
pub fn dedupe_titles(items: Vec<(ProviderKind, CatalogItem)>) -> Vec<(ProviderKind, CatalogItem)> {
    let norms: Vec<String> = items
        .iter()
        .map(|(_, i)| normalize_title(&i.title))
        .collect();
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by_key(|&i| {
        let (provider, item) = &items[i];
        (priority(*provider, item), has_dub_tag(&item.title), i)
    });

    let mut kept: Vec<usize> = Vec::new();
    for i in order {
        let duplicate = kept
            .iter()
            .any(|&k| same_title(&items[k], &items[i], &norms[k], &norms[i]));
        if !duplicate {
            kept.push(i);
        }
    }
    kept.sort_unstable();

    let mut slots: Vec<Option<(ProviderKind, CatalogItem)>> = items.into_iter().map(Some).collect();
    kept.into_iter()
        .filter_map(|i| slots[i].take())
        .map(|(provider, mut item)| {
            if matches!(provider, ProviderKind::MovieBox | ProviderKind::FourKHdHub) {
                item.title = display_title(&item.title);
            }
            (provider, item)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::models::ProviderMediaId;

    fn item(
        provider: ProviderKind,
        id: &str,
        title: &str,
        media: MediaType,
        year: Option<&str>,
    ) -> (ProviderKind, CatalogItem) {
        (
            provider,
            CatalogItem {
                id: ProviderMediaId {
                    provider,
                    value: id.into(),
                },
                title: title.into(),
                media_type: media,
                year: year.map(str::to_string),
                poster_url: None,
                season_count: None,
            },
        )
    }

    fn ids(out: &[(ProviderKind, CatalogItem)]) -> Vec<&str> {
        out.iter().map(|(_, i)| i.id.value.as_str()).collect()
    }

    #[test]
    fn scraped_movie_label_of_a_catalog_series_is_the_same_title() {
        let out = dedupe_titles(vec![
            item(
                ProviderKind::Collaps,
                "tt10466872",
                "Dune: Prophecy",
                MediaType::Series,
                Some("2024"),
            ),
            item(
                ProviderKind::MovieBox,
                "mb9",
                "Dune: Prophecy",
                MediaType::Movie,
                Some("2024"),
            ),
        ]);
        assert_eq!(ids(&out), ["tt10466872"]);
    }

    #[test]
    fn a_movie_and_a_show_sharing_a_name_in_different_years_both_stay() {
        let out = dedupe_titles(vec![
            item(
                ProviderKind::Collaps,
                "tt1",
                "Fargo",
                MediaType::Movie,
                Some("1996"),
            ),
            item(
                ProviderKind::Collaps,
                "tt2",
                "Fargo",
                MediaType::Series,
                Some("2014"),
            ),
            item(
                ProviderKind::MovieBox,
                "mb2",
                "Fargo",
                MediaType::Movie,
                Some("2014"),
            ),
        ]);
        // The 2014 scraped "movie" is the show; the 1996 film stays.
        assert_eq!(ids(&out), ["tt1", "tt2"]);
    }

    #[test]
    fn one_inception_regardless_of_source_order() {
        let items = vec![
            item(
                ProviderKind::MovieBox,
                "mb1",
                "Inception [Hindi]",
                MediaType::Movie,
                Some("2010"),
            ),
            item(
                ProviderKind::FourKHdHub,
                "k1",
                "Inception",
                MediaType::Movie,
                Some("2010"),
            ),
            item(
                ProviderKind::Collaps,
                "tt1375666",
                "Inception",
                MediaType::Movie,
                Some("2010"),
            ),
            item(
                ProviderKind::MovieBox,
                "mb2",
                "Inception",
                MediaType::Movie,
                Some("2010"),
            ),
        ];
        let out = dedupe_titles(items);
        assert_eq!(ids(&out), ["tt1375666"]);
    }

    #[test]
    fn keeps_distinct_years_and_unrelated_titles() {
        let items = vec![
            item(
                ProviderKind::Collaps,
                "tt0087182",
                "Dune",
                MediaType::Movie,
                Some("1984"),
            ),
            item(
                ProviderKind::Collaps,
                "tt1160419",
                "Dune",
                MediaType::Movie,
                Some("2021"),
            ),
            item(
                ProviderKind::MovieBox,
                "mb",
                "Dune [Hindi]",
                MediaType::Movie,
                Some("2021"),
            ),
            item(
                ProviderKind::Collaps,
                "tt15239678",
                "Dune: Part Two",
                MediaType::Movie,
                Some("2024"),
            ),
        ];
        let out = dedupe_titles(items);
        assert_eq!(ids(&out), ["tt0087182", "tt1160419", "tt15239678"]);
    }

    #[test]
    fn movie_and_series_with_the_same_name_are_different_titles() {
        let items = vec![
            item(
                ProviderKind::Collaps,
                "tt1",
                "Fargo",
                MediaType::Movie,
                Some("1996"),
            ),
            item(
                ProviderKind::Collaps,
                "tt2",
                "Fargo",
                MediaType::Series,
                Some("1996"),
            ),
        ];
        assert_eq!(
            dedupe_titles(items).len(),
            2,
            "movie and series are different titles"
        );
    }

    #[test]
    fn kinds_must_agree_unless_anime() {
        let movie_series = vec![
            item(
                ProviderKind::Collaps,
                "a",
                "Luther",
                MediaType::Movie,
                Some("2022"),
            ),
            item(
                ProviderKind::MovieBox,
                "b",
                "Luther",
                MediaType::Series,
                Some("2022"),
            ),
        ];
        assert_eq!(dedupe_titles(movie_series).len(), 2);
        let anime = vec![
            item(
                ProviderKind::Collaps,
                "tt21209876",
                "Solo Leveling",
                MediaType::Series,
                Some("2024"),
            ),
            item(
                ProviderKind::Anime,
                "anilist",
                "Solo Leveling",
                MediaType::Anime,
                None,
            ),
        ];
        let out = dedupe_titles(anime);
        assert_eq!(ids(&out), ["anilist"], "anime source wins");
    }

    #[test]
    fn all_seasons_of_a_scraped_show_collapse_and_titles_are_cleaned() {
        let items = vec![
            item(
                ProviderKind::MovieBox,
                "s5",
                "Breaking Bad [Hindi] S5",
                MediaType::Series,
                Some("2012"),
            ),
            item(
                ProviderKind::MovieBox,
                "s4",
                "Breaking Bad [Hindi] S4",
                MediaType::Series,
                Some("2011"),
            ),
            item(
                ProviderKind::MovieBox,
                "x",
                "Money Heist [English]",
                MediaType::Series,
                Some("2017"),
            ),
        ];
        let out = dedupe_titles(items);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].1.title, "Breaking Bad");
        assert_eq!(out[1].1.title, "Money Heist");
    }

    #[test]
    fn scraped_seasons_merge_into_the_show_but_distinct_cinemeta_shows_stay_apart() {
        let items = vec![
            item(
                ProviderKind::Collaps,
                "tt0903747",
                "Breaking Bad",
                MediaType::Series,
                Some("2008"),
            ),
            item(
                ProviderKind::MovieBox,
                "s2",
                "Breaking Bad [Hindi] S2",
                MediaType::Series,
                Some("2009"),
            ),
            item(
                ProviderKind::MovieBox,
                "s5",
                "Breaking Bad [Hindi] S5",
                MediaType::Series,
                Some("2012"),
            ),
            item(
                ProviderKind::FourKHdHub,
                "k",
                "Breaking Bad",
                MediaType::Series,
                Some("2013"),
            ),
        ];
        assert_eq!(ids(&dedupe_titles(items)), ["tt0903747"]);

        let offices = vec![
            item(
                ProviderKind::Collaps,
                "uk",
                "The Office",
                MediaType::Series,
                Some("2001"),
            ),
            item(
                ProviderKind::Collaps,
                "us",
                "The Office",
                MediaType::Series,
                Some("2005"),
            ),
        ];
        assert_eq!(dedupe_titles(offices).len(), 2);

        // A scraped entry far *before* the show's start is some other show.
        let remake = vec![
            item(
                ProviderKind::Collaps,
                "new",
                "Battlestar Galactica",
                MediaType::Series,
                Some("2004"),
            ),
            item(
                ProviderKind::MovieBox,
                "old",
                "Battlestar Galactica",
                MediaType::Series,
                Some("1978"),
            ),
        ];
        assert_eq!(dedupe_titles(remake).len(), 2);
    }

    #[test]
    fn untagged_copy_of_the_same_source_wins_and_order_is_preserved() {
        let items = vec![
            item(
                ProviderKind::MovieBox,
                "tagged",
                "Parasite [Hindi]",
                MediaType::Movie,
                Some("2019"),
            ),
            item(
                ProviderKind::Collaps,
                "other",
                "Zodiac",
                MediaType::Movie,
                Some("2007"),
            ),
            item(
                ProviderKind::MovieBox,
                "plain",
                "Parasite",
                MediaType::Movie,
                Some("2019"),
            ),
        ];
        let out = dedupe_titles(items);
        assert_eq!(ids(&out), ["other", "plain"]);
    }

    #[test]
    fn collaps_titles_are_not_rewritten() {
        let items = vec![item(
            ProviderKind::Collaps,
            "t",
            "Spider-Man: No Way Home",
            MediaType::Movie,
            Some("2021"),
        )];
        assert_eq!(dedupe_titles(items)[0].1.title, "Spider-Man: No Way Home");
    }

    #[test]
    fn empty_in_empty_out() {
        assert!(dedupe_titles(vec![]).is_empty());
    }
}
