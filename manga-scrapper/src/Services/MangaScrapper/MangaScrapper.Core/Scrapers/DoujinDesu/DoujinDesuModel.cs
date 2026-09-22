using System.Text.Json.Serialization;

namespace MangaScrapper.Core.Scrapers.DoujinDesu;

public class DoujinDesuEncryptedResponse
{
    [JsonPropertyName("_enc_resp_")]
    public string? EncryptedResponse { get; set; }
}

public class DoujinDesuMangaDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("slug")]
    public string Slug { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("cover_url")]
    public string? CoverUrl { get; set; }

    [JsonPropertyName("author")]
    public string? Author { get; set; }

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("rating")]
    public double? Rating { get; set; }

    [JsonPropertyName("views")]
    public int? Views { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime? CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public DateTime? UpdatedAt { get; set; }

    [JsonPropertyName("alt_titles")]
    public string? AltTitles { get; set; }

    [JsonPropertyName("term_list")]
    public string? TermList { get; set; }

    [JsonPropertyName("terms")]
    public string? Terms { get; set; }

    [JsonPropertyName("chapter_count")]
    public int? ChapterCount { get; set; }

    [JsonPropertyName("manga_genres")]
    public List<DoujinDesuMangaGenreItemDto>? MangaGenres { get; set; }

    [JsonPropertyName("chapters")]
    public List<DoujinDesuChapterItemDto>? Chapters { get; set; }
}

public class DoujinDesuMangaGenreItemDto
{
    [JsonPropertyName("manga_id")]
    public string? MangaId { get; set; }

    [JsonPropertyName("genre_id")]
    public int? GenreId { get; set; }

    [JsonPropertyName("genres")]
    public DoujinDesuGenreDto? Genres { get; set; }
}

public class DoujinDesuGenreDto
{
    [JsonPropertyName("id")]
    public int? Id { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("slug")]
    public string? Slug { get; set; }
}

public class DoujinDesuChapterItemDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("chapter_number")]
    public double ChapterNumber { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("views")]
    public int? Views { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime? CreatedAt { get; set; }

    [JsonPropertyName("download_link")]
    public string? DownloadLink { get; set; }

    [JsonPropertyName("batch_link")]
    public string? BatchLink { get; set; }
}

public class DoujinDesuChapterDetailDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("chapter_number")]
    public double ChapterNumber { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("manga_id")]
    public string? MangaId { get; set; }

    [JsonPropertyName("manga_title")]
    public string? MangaTitle { get; set; }

    [JsonPropertyName("manga_slug")]
    public string? MangaSlug { get; set; }

    [JsonPropertyName("content_urls")]
    public List<string>? ContentUrls { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime? CreatedAt { get; set; }

    [JsonPropertyName("views")]
    public int? Views { get; set; }
}
