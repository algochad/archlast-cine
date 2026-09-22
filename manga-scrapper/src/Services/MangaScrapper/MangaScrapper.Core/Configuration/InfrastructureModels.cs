namespace MangaScrapper.Core.Configuration;

public class SearchItem
{
    public string? Title { get; set; }
    public string DetailUrl { get; set; } = string.Empty;
    public string Thumbnail { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Genre { get; set; } = string.Empty;
    public string LastUpdateText { get; set; } = string.Empty;
    public double LatestChapterNumber { get; set; }
    public DateTime? LatestScrapped { get; set; }
    public double CurrentChapterNumber { get; set; }
    public string? MangaId { get; set; }
}

public class SearchRequest
{
    public string? Keyword { get; set; }
    public List<string>? Genres { get; set; }
    public string? Status { get; set; }
    public string? Type { get; set; }
    public int Page { get; set; } = 1;
}

public class DetailRequest
{
    public string MangaUrl { get; set; } = string.Empty;
}

public class MeiliMangaDocument
{
    public string Id { get; set; } = string.Empty;
    public int MalId { get; set; }
    public int? AnilistId { get; set; }
    public long? MangaUpdateId { get; set; }
    public string Title { get; set; } = string.Empty;
    public List<string> Synonyms { get; set; } = new();
    public string Author { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public double? Rating { get; set; }
    public int Popularity { get; set; }
    public int Members { get; set; }
    public List<string> Genres { get; set; } = new();
    public List<string> Categories { get; set; } = new();
    public string? Description { get; set; }
    public string? Status { get; set; }
    public bool Nsfw { get; set; } = false;
    public int TotalView { get; set; }
    public long ReleaseDate { get; set; }
    public string? ImageUrl { get; set; }
    public string? LocalImageUrl { get; set; }
    public int TotalChapters { get; set; }
    public double LatestChapterNumber { get; set; }
    public long CreatedAtTimestamp { get; set; }
    public long UpdatedAtTimestamp { get; set; }
    public string? Url { get; set; }
    public MeiliChapterDocument LatestChapter { get; set; } = new();
}

public class MeiliChapterDocument
{
    public string Id { get; set; } = string.Empty;
    public double Number { get; set; }
    public string? Link { get; set; }
    public string? ChapterProvider { get; set; }
    public string? ChapterProviderIcon { get; set; }
    public string Language { get; set; } = string.Empty;
    public int TotalView { get; set; }
    public long UploadDateTimestamp { get; set; }
}

public class ScrapperProvider
{
    public string ProviderName { get; set; } = string.Empty;
    public string BaseUrl { get; set; } = string.Empty;
    public string ProviderIcon { get; set; } = string.Empty;
    public string? AppSecret { get; set; }
    public string? Salt { get; set; }
    public MangaSelectorConfig MangaSelectors { get; set; } = new();
    public ChapterSelectorConfig ChapterSelectors { get; set; } = new();
    public PageSelectorConfig PageSelectors { get; set; } = new();
}

public class MangaSelectorConfig
{
    public string Title { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Genres { get; set; } = string.Empty;
    public string Thumbnail { get; set; } = string.Empty;
}

public class ChapterSelectorConfig
{
    public string Rows { get; set; } = string.Empty;
    public string Link { get; set; } = string.Empty;
    public string ChapterText { get; set; } = string.Empty;
    public string Views { get; set; } = string.Empty;
    public string UploadDate { get; set; } = string.Empty;
}

public class PageSelectorConfig
{
    public string Images { get; set; } = string.Empty;
}
