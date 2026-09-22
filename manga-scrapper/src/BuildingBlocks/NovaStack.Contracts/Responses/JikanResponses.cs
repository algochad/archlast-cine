using System.Text.Json.Serialization;

namespace NovaStack.Contracts.Responses;

public record JikanMangaSearchDto(
    int MalId,
    string? Title,
    string? Thumbnail,
    double? Score);

public record JikanMangaResponse(
    [property: JsonPropertyName("data")] List<JikanMangaItem>? Data,
    [property: JsonPropertyName("pagination")] JikanPagination? Pagination);

public record JikanMangaSingleResponse(
    [property: JsonPropertyName("data")] JikanMangaItem? Data);

public record JikanMangaItem(
    [property: JsonPropertyName("mal_id")] int MalId,
    [property: JsonPropertyName("url")] string? Url,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("title_english")] string? TitleEnglish,
    [property: JsonPropertyName("title_japanese")] string? TitleJapanese,
    [property: JsonPropertyName("title_synonyms")] List<string>? TitleSynonyms,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("chapters")] int? Chapters,
    [property: JsonPropertyName("volumes")] int? Volumes,
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("score")] double? Score,
    [property: JsonPropertyName("synopsis")] string? Synopsis,
    [property: JsonPropertyName("images")] JikanImages? Images,
    [property: JsonPropertyName("authors")] List<JikanAuthor>? Authors,
    [property: JsonPropertyName("genres")] List<JikanGenre>? Genres,
    [property: JsonPropertyName("published")] JikanPublished? Published,
    [property: JsonPropertyName("popularity")] int Popularity,
    [property: JsonPropertyName("members")] int Members);

public record JikanImages(
    [property: JsonPropertyName("jpg")] JikanImageDetail? Jpg,
    [property: JsonPropertyName("webp")] JikanImageDetail? Webp);

public record JikanImageDetail(
    [property: JsonPropertyName("image_url")] string? ImageUrl,
    [property: JsonPropertyName("small_image_url")] string? SmallImageUrl,
    [property: JsonPropertyName("large_image_url")] string? LargeImageUrl);

public record JikanGenre(
    [property: JsonPropertyName("mal_id")] int MalId,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("url")] string? Url);

public record JikanAuthor(
    [property: JsonPropertyName("mal_id")] int MalId,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("url")] string? Url);

public record JikanPublished(
    [property: JsonPropertyName("from")] DateTime? From,
    [property: JsonPropertyName("to")] DateTime? To,
    [property: JsonPropertyName("string")] string? String);

public record JikanPagination(
    [property: JsonPropertyName("last_visible_page")] int LastVisiblePage,
    [property: JsonPropertyName("has_next_page")] bool HasNextPage,
    [property: JsonPropertyName("current_page")] int CurrentPage);
