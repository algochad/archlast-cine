using System.Text.Json.Serialization;

namespace MangaScrapper.Core.Scrapers.MangaDex;

// â”€â”€â”€ Generic wrapper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

public class MangaDexResponse<T>
{
    [JsonPropertyName("result")]
    public string Result { get; set; } = string.Empty;

    [JsonPropertyName("response")]
    public string Response { get; set; } = string.Empty;

    [JsonPropertyName("data")]
    public T? Data { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }

    [JsonPropertyName("offset")]
    public int Offset { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }
}

// â”€â”€â”€ Relationship helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

public class MangaDexRelationship
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("attributes")]
    public MangaDexRelationshipAttributes? Attributes { get; set; }
}

public class MangaDexRelationshipAttributes
{
    // Manga attributes (when type == "manga")
    [JsonPropertyName("title")]
    public Dictionary<string, string>? Title { get; set; }

    [JsonPropertyName("tags")]
    public List<MangaDexTag>? Tags { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("originalLanguage")]
    public string? OriginalLanguage { get; set; }

    [JsonPropertyName("publicationDemographic")]
    public string? PublicationDemographic { get; set; }

    [JsonPropertyName("contentRating")]
    public string? ContentRating { get; set; }

    // Cover art attributes (when type == "cover_art")
    [JsonPropertyName("fileName")]
    public string? FileName { get; set; }

    // Author/artist attributes (when type == "author" or "artist")
    [JsonPropertyName("name")]
    public string? Name { get; set; }
}

// â”€â”€â”€ Tag â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

public class MangaDexTag
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("attributes")]
    public MangaDexTagAttributes Attributes { get; set; } = new();
}

public class MangaDexTagAttributes
{
    [JsonPropertyName("name")]
    public Dictionary<string, string> Name { get; set; } = new();

    [JsonPropertyName("group")]
    public string Group { get; set; } = string.Empty;
}

// â”€â”€â”€ Chapter (feed endpoint) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

public class MangaDexChapter
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("attributes")]
    public MangaDexChapterAttributes Attributes { get; set; } = new();

    [JsonPropertyName("relationships")]
    public List<MangaDexRelationship> Relationships { get; set; } = new();
}

public class MangaDexChapterAttributes
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("volume")]
    public string? Volume { get; set; }

    [JsonPropertyName("chapter")]
    public string? Chapter { get; set; }

    [JsonPropertyName("translatedLanguage")]
    public string TranslatedLanguage { get; set; } = string.Empty;

    [JsonPropertyName("readableAt")]
    public DateTime ReadableAt { get; set; }

    [JsonPropertyName("publishAt")]
    public DateTime PublishAt { get; set; }
}

// â”€â”€â”€ Manga (search endpoint) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

public class MangaDexManga
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("attributes")]
    public MangaDexMangaAttributes Attributes { get; set; } = new();

    [JsonPropertyName("relationships")]
    public List<MangaDexRelationship> Relationships { get; set; } = new();
}

public class MangaDexMangaAttributes
{
    [JsonPropertyName("title")]
    public Dictionary<string, string> Title { get; set; } = new();

    [JsonPropertyName("altTitles")]
    public List<Dictionary<string, string>> AltTitles { get; set; } = new();

    [JsonPropertyName("description")]
    public Dictionary<string, string> Description { get; set; } = new();

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("originalLanguage")]
    public string OriginalLanguage { get; set; } = string.Empty;

    [JsonPropertyName("publicationDemographic")]
    public string? PublicationDemographic { get; set; }

    [JsonPropertyName("contentRating")]
    public string ContentRating { get; set; } = string.Empty;

    [JsonPropertyName("tags")]
    public List<MangaDexTag> Tags { get; set; } = new();

    [JsonPropertyName("updatedAt")]
    public DateTime UpdatedAt { get; set; }
}

// â”€â”€â”€ At-home server (chapter pages) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

public class MangaDexAtHomeResponse
{
    [JsonPropertyName("result")]
    public string Result { get; set; } = string.Empty;

    [JsonPropertyName("baseUrl")]
    public string BaseUrl { get; set; } = string.Empty;

    [JsonPropertyName("chapter")]
    public MangaDexAtHomeChapter Chapter { get; set; } = new();
}

public class MangaDexAtHomeChapter
{
    [JsonPropertyName("hash")]
    public string Hash { get; set; } = string.Empty;

    [JsonPropertyName("data")]
    public List<string> Data { get; set; } = new();

    [JsonPropertyName("dataSaver")]
    public List<string> DataSaver { get; set; } = new();
}

// â”€â”€â”€ Statistics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

public class MangaDexStatisticsResponse
{
    [JsonPropertyName("result")]
    public string Result { get; set; } = string.Empty;

    [JsonPropertyName("statistics")]
    public Dictionary<string, MangaDexMangaStatistics> Statistics { get; set; } = new();
}

public class MangaDexMangaStatistics
{
    [JsonPropertyName("rating")]
    public MangaDexRating? Rating { get; set; }
}

public class MangaDexRating
{
    [JsonPropertyName("average")]
    public double? Average { get; set; }
}


