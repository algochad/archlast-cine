//! Cinemeta (Stremio's public, keyless metadata addon) → crate models.
//!
//! Cinemeta aggregates TMDB / IMDb / TVDB and is keyed by IMDb id, which is
//! exactly what the Collaps embed lookup takes. Field shapes vary between
//! catalog and meta responses (numbers as strings, empty ratings, lists as
//! arrays or comma strings), so everything is read leniently from `Value`.

use serde_json::Value;

use crate::models::BrowseMetrics;
use crate::providers::models::{
    CatalogItem, Episode, MediaDetails, MediaType, ProviderKind, ProviderMediaId, Season,
};

fn text(v: &Value, key: &str) -> Option<String> {
    match v.get(key)? {
        Value::String(s) => Some(s.trim().to_string()).filter(|s| !s.is_empty()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn list(v: &Value, key: &str) -> Vec<String> {
    match v.get(key) {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        Some(Value::String(s)) => s
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn number(v: &Value, key: &str) -> Option<f64> {
    let n = match v.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }?;
    n.is_finite().then_some(n)
}

/// The IMDb id (`tt…`) of a meta, or `None` for non-IMDb entries.
pub fn imdb_id(meta: &Value) -> Option<String> {
    text(meta, "imdb_id")
        .or_else(|| text(meta, "id"))
        .filter(|id| {
            id.starts_with("tt") && id.len() > 2 && id[2..].bytes().all(|b| b.is_ascii_digit())
        })
}

/// First four-digit year of `year` / `releaseInfo` ("2011–2019" → "2011").
pub fn year_of(meta: &Value) -> Option<String> {
    [text(meta, "year"), text(meta, "releaseInfo")]
        .into_iter()
        .flatten()
        .find_map(|raw| {
            let digits: String = raw.chars().take_while(char::is_ascii_digit).collect();
            (digits.len() == 4).then_some(digits)
        })
}

fn media_type_of(meta: &Value) -> MediaType {
    if text(meta, "type").as_deref() == Some("series") {
        MediaType::Series
    } else {
        MediaType::Movie
    }
}

/// Catalog posters default to metahub's `small` size; cards want `medium`.
fn poster_of(meta: &Value) -> Option<String> {
    text(meta, "poster")
        .filter(|p| crate::net::is_http_url(p))
        .map(|p| p.replace("/poster/small/", "/poster/medium/"))
}

pub fn to_catalog_item(meta: &Value) -> Option<CatalogItem> {
    let id = imdb_id(meta)?;
    let title = text(meta, "name")?;
    Some(CatalogItem {
        id: ProviderMediaId {
            provider: ProviderKind::Collaps,
            value: id,
        },
        title,
        media_type: media_type_of(meta),
        year: year_of(meta),
        poster_url: poster_of(meta),
        season_count: None,
    })
}

/// Home-row metrics: TMDB popularity drives "Trending", IMDb rating drives
/// "Top Rated" (and "Fresh & Hot" for titles from the last two years), Trakt
/// watchers drive "Most Watched".
pub fn to_metrics(meta: &Value, current_year: i32) -> BrowseMetrics {
    let popularities = meta.get("popularities").cloned().unwrap_or(Value::Null);
    let rating = number(meta, "imdbRating").filter(|r| *r > 0.0);
    let recent = year_of(meta)
        .and_then(|y| y.parse::<i32>().ok())
        .is_some_and(|y| y >= current_year - 1);
    BrowseMetrics {
        trending: number(&popularities, "moviedb").or_else(|| number(meta, "popularity")),
        rating,
        recent_rating: rating.filter(|_| recent),
        popularity: number(&popularities, "trakt").or_else(|| number(&popularities, "stremio")),
    }
}

/// Seasons from a series meta's `videos`; specials (season 0) are dropped
/// because the stream source never carries them.
fn seasons_of(meta: &Value) -> Vec<Season> {
    let mut seasons: Vec<Season> = Vec::new();
    for video in meta
        .get("videos")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (Some(season), Some(number)) = (
            number(video, "season"),
            number(video, "episode").or_else(|| number(video, "number")),
        ) else {
            continue;
        };
        let (season, number) = (season as usize, number as usize);
        if season == 0 || number == 0 {
            continue;
        }
        let title = text(video, "name").or_else(|| text(video, "title"));
        let episode = Episode {
            season,
            number,
            title,
        };
        match seasons.iter_mut().find(|s| s.number == season) {
            Some(s) => s.episodes.push(episode),
            None => seasons.push(Season {
                number: season,
                episodes: vec![episode],
            }),
        }
    }
    seasons.sort_by_key(|s| s.number);
    for s in &mut seasons {
        s.episodes.sort_by_key(|e| e.number);
        s.episodes.dedup_by_key(|e| e.number);
    }
    seasons
}

pub fn to_details(meta: &Value) -> Option<MediaDetails> {
    let item = to_catalog_item(meta)?;
    let seasons = if item.media_type == MediaType::Series {
        seasons_of(meta)
    } else {
        Vec::new()
    };
    let joined = |values: Vec<String>, max: usize| {
        let values: Vec<String> = values.into_iter().take(max).collect();
        (!values.is_empty()).then(|| values.join(", "))
    };
    Some(MediaDetails {
        id: item.id,
        title: item.title,
        media_type: item.media_type,
        year: item.year,
        description: text(meta, "description"),
        tagline: None,
        imdb_rating: number(meta, "imdbRating")
            .filter(|r| *r > 0.0)
            .map(|r| format!("{r:.1}")),
        director: joined(list(meta, "director"), 3),
        stars: joined(list(meta, "cast"), 5),
        prints: None,
        audios: None,
        poster_url: text(meta, "poster").filter(|p| crate::net::is_http_url(p)),
        duration: text(meta, "runtime"),
        genres: {
            let genres = list(meta, "genres");
            if genres.is_empty() {
                list(meta, "genre")
            } else {
                genres
            }
        },
        seasons,
        dubs: Vec::new(),
        anime_ids: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn catalog_item_from_top_catalog_entry() {
        let meta = json!({
            "id": "tt34384900", "imdb_id": "tt34384900", "type": "movie",
            "name": "Love of Your Life", "releaseInfo": "2026",
            "poster": "https://images.metahub.space/poster/small/tt34384900/img",
        });
        let item = to_catalog_item(&meta).unwrap();
        assert_eq!(item.id.provider, ProviderKind::Collaps);
        assert_eq!(item.id.value, "tt34384900");
        assert_eq!(item.media_type, MediaType::Movie);
        assert_eq!(item.year.as_deref(), Some("2026"));
        assert_eq!(
            item.poster_url.as_deref(),
            Some("https://images.metahub.space/poster/medium/tt34384900/img")
        );
    }

    #[test]
    fn rejects_non_imdb_and_untitled_entries() {
        assert!(to_catalog_item(&json!({"id": "kitsu:1", "name": "X"})).is_none());
        assert!(to_catalog_item(&json!({"id": "tt", "name": "X"})).is_none());
        assert!(to_catalog_item(&json!({"id": "tt12a", "name": "X"})).is_none());
        assert!(to_catalog_item(&json!({"id": "tt123", "name": "  "})).is_none());
    }

    #[test]
    fn year_from_ranges_and_numbers() {
        assert_eq!(
            year_of(&json!({"releaseInfo": "2011–2019"})).as_deref(),
            Some("2011")
        );
        assert_eq!(year_of(&json!({"year": 1999})).as_deref(), Some("1999"));
        assert_eq!(
            year_of(&json!({"year": "", "releaseInfo": "2024-"})).as_deref(),
            Some("2024")
        );
        assert_eq!(year_of(&json!({})), None);
    }

    #[test]
    fn metrics_from_popularities_and_rating() {
        let meta = json!({
            "imdbRating": "8.8", "year": "2025",
            "popularities": {"moviedb": 78.15, "trakt": 526, "stremio": 3.8},
        });
        let m = to_metrics(&meta, 2026);
        assert_eq!(m.trending, Some(78.15));
        assert_eq!(m.rating, Some(8.8));
        assert_eq!(m.recent_rating, Some(8.8));
        assert_eq!(m.popularity, Some(526.0));
        let old = to_metrics(&json!({"imdbRating": "", "year": "1990"}), 2026);
        assert_eq!(old.rating, None);
        assert_eq!(old.recent_rating, None);
        assert_eq!(old.trending, None);
    }

    #[test]
    fn series_details_group_videos_and_drop_specials() {
        let meta = json!({
            "id": "tt0944947", "type": "series", "name": "Game of Thrones",
            "releaseInfo": "2011–2019", "imdbRating": "9.2", "runtime": "57 min",
            "director": null, "cast": ["A", "B"], "genres": ["Drama"],
            "videos": [
                {"season": "1", "episode": "2", "name": "The Kingsroad"},
                {"season": 0, "episode": 1, "name": "Inside"},
                {"season": 1, "episode": 1, "name": "Winter Is Coming"},
                {"season": 2, "number": 1, "title": "The North Remembers"},
                {"season": 1, "episode": 1, "name": "dup"},
            ],
        });
        let d = to_details(&meta).unwrap();
        assert_eq!(d.media_type, MediaType::Series);
        assert_eq!(d.seasons.len(), 2);
        assert_eq!(
            d.seasons[0]
                .episodes
                .iter()
                .map(|e| e.number)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert_eq!(
            d.seasons[0].episodes[0].title.as_deref(),
            Some("Winter Is Coming")
        );
        assert_eq!(
            d.seasons[1].episodes[0].title.as_deref(),
            Some("The North Remembers")
        );
        assert_eq!(d.imdb_rating.as_deref(), Some("9.2"));
        assert_eq!(d.director, None);
        assert_eq!(d.stars.as_deref(), Some("A, B"));
    }

    #[test]
    fn movie_details_ignore_videos_and_fall_back_to_genre() {
        let meta = json!({
            "id": "tt1375666", "type": "movie", "name": "Inception", "year": "2010",
            "director": ["Christopher Nolan"], "genre": ["Action", "Sci-Fi"],
            "videos": [{"season": 1, "episode": 1}],
        });
        let d = to_details(&meta).unwrap();
        assert!(d.seasons.is_empty());
        assert_eq!(d.director.as_deref(), Some("Christopher Nolan"));
        assert_eq!(d.genres, ["Action", "Sci-Fi"]);
    }
}
