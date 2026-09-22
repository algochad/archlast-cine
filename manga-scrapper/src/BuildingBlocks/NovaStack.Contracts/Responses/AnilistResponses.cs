using System.Text.Json.Serialization;

namespace NovaStack.Contracts.Responses;

public record AnilistResponse(
    [property: JsonPropertyName("data")] AnilistData? Data);

public record AnilistData(
    [property: JsonPropertyName("Page")] AnilistPage? Page);

public record AnilistPage(
    [property: JsonPropertyName("media")] List<AnilistMedia>? Media);

public enum ComicType
{
    Unknown,
    Manga,  // JP
    Manhwa, // KR
    Manhua  // CN, TW, HK
}
public record AnilistMedia(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("idMal")] int? IdMal,
    [property: JsonPropertyName("title")] AnilistTitle? Title,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("countryOfOrigin")] string? CountryOfOrigin,
    [property: JsonPropertyName("format")] string? Format,
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("chapters")] int? Chapters,
    [property: JsonPropertyName("volumes")] int? Volumes,
    [property: JsonPropertyName("coverImage")] AnilistCoverImage? CoverImage,
    [property: JsonPropertyName("averageScore")] int? AverageScore,
    [property: JsonPropertyName("popularity")] int? Popularity,
    [property: JsonPropertyName("favourites")] int? Favorites,
    [property: JsonPropertyName("genres")] List<string>? Genres,
    [property: JsonPropertyName("synonyms")] List<string>? Synonyms,
    [property: JsonPropertyName("tags")] List<AnilistTag>? Tags,
    [property: JsonPropertyName("startDate")] AnilistFuzzyDate? StartDate,
    [property: JsonPropertyName("staff")] AnilistStaffConnection? Staff)
{
    /// <summary>
    /// Gets the comic classification derived from CountryOfOrigin.
    /// </summary>
    [JsonIgnore]
    public ComicType ComicType => CountryOfOrigin switch
    {
        "JP" => ComicType.Manga,
        "KR" => ComicType.Manhwa,
        "CN" or "TW" or "HK" => ComicType.Manhua,
        _ => ComicType.Unknown
    };
}


public record AnilistTitle(
    [property: JsonPropertyName("romaji")] string? Romaji,
    [property: JsonPropertyName("english")] string? English,
    [property: JsonPropertyName("native")] string? Native);

public record AnilistCoverImage(
    [property: JsonPropertyName("extraLarge")] string? ExtraLarge,
    [property: JsonPropertyName("large")] string? Large,
    [property: JsonPropertyName("medium")] string? Medium);

public record AnilistFuzzyDate(
    [property: JsonPropertyName("year")] int? Year,
    [property: JsonPropertyName("month")] int? Month,
    [property: JsonPropertyName("day")] int? Day);

public record AnilistStaffConnection(
    [property: JsonPropertyName("edges")] List<AnilistStaffEdge>? Edges);

public record AnilistStaffEdge(
    [property: JsonPropertyName("role")] string? Role,
    [property: JsonPropertyName("node")] AnilistStaffNode? Node);

public record AnilistStaffNode(
    [property: JsonPropertyName("name")] AnilistStaffName? Name);

public record AnilistStaffName(
    [property: JsonPropertyName("full")] string? Full);

public record AnilistTag(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("rank")] int? Rank);
