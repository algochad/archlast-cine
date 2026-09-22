using System.Text.Json.Serialization;

namespace NovaStack.Contracts.Responses;

public record MangaUpdatesSearchResponse(
    [property: JsonPropertyName("results")] List<MangaUpdatesSearchResult>? Results);

public record MangaUpdatesSearchResult(
    [property: JsonPropertyName("record")] MangaUpdatesRecord? Record);

public record MangaUpdatesRecord(
    [property: JsonPropertyName("series_id")] long? SeriesId,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("image")] MangaUpdatesImage? Image,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("year")] string? Year,
    [property: JsonPropertyName("bayesian_rating")] double? BayesianRating,
    [property: JsonPropertyName("genres")] List<MangaUpdatesGenre>? Genres);

public record MangaUpdatesImage(
    [property: JsonPropertyName("url")] MangaUpdatesImageUrl? Url);

public record MangaUpdatesImageUrl(
    [property: JsonPropertyName("original")] string? Original,
    [property: JsonPropertyName("thumb")] string? Thumb);

public record MangaUpdatesGenre(
    [property: JsonPropertyName("genre")] string? Genre);

public record MangaUpdatesSeriesResponse(
    [property: JsonPropertyName("series_id")] long? SeriesId,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("image")] MangaUpdatesImage? Image,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("year")] string? Year,
    [property: JsonPropertyName("bayesian_rating")] double? BayesianRating,
    [property: JsonPropertyName("genres")] List<MangaUpdatesGenre>? Genres,
    [property: JsonPropertyName("completed")] bool Completed,
    [property: JsonPropertyName("authors")] List<MangaUpdatesAuthor>? Authors,
    [property: JsonPropertyName("categories")] List<MangaUpdatesCategory>? Categories);

public record MangaUpdatesAuthor(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("type")] string? Type);

public record MangaUpdatesCategory(
    [property: JsonPropertyName("category")] string? Category,
    [property: JsonPropertyName("votes")] int Votes=0);
