namespace NovaStack.Contracts.Responses;

public class SearchItemResponse
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

public class ScrapperSearchRequest
{
    public string? Keyword { get; set; }
    public string[]? Genres { get; set; }
    public string? Status { get; set; }
    public string? Type { get; set; }
    public int Page { get; set; } = 1;
}

public class ScrapperDetailRequest
{
    public string MangaUrl { get; set; } = string.Empty;
}

public class ProviderScrapMangaRequest
{
    public string MangaUrl { get; set; } = string.Empty;
    public bool ScrapChapterPages { get; set; } = true;
    public string? LinkId { get; set; }
}

public class ScrapperChapterDocumentResponse
{
    public Guid Id { get; set; }
    public double Number { get; set; }
    public string? Link { get; set; }
    public string? ChapterProvider { get; set; }
    public string? ChapterProviderIcon { get; set; }
    public string Language { get; set; } = string.Empty;
    public int TotalView { get; set; }
    public DateTime UploadDate { get; set; }
    public List<ScrapperPageDocumentResponse> Pages { get; set; } = new();
}

public class ScrapperPageDocumentResponse
{
    public string ImageUrl { get; set; } = string.Empty;
    public string LocalImageUrl { get; set; } = string.Empty;
    public long Size { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool IsFallback { get; set; }
}

public class ScrapperMangaDocumentResponse
{
    public Guid Id { get; set; }
    public int MalID { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public double? Rating { get; set; }
    public int Popularity { get; set; }
    public int Members { get; set; }
    public List<string>? Genres { get; set; }
    public string? Description { get; set; }
    public string? ImageUrl { get; set; }
    public string? LocalImageUrl { get; set; }
    public long ThumbnailSize { get; set; }
    public string? Status { get; set; }
    public DateTime? ReleaseDate { get; set; }
    public int TotalView { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string? Url { get; set; }
    public List<ScrapperChapterDocumentResponse> Chapters { get; set; } = new();
}

public class ProviderInfoResponse
{
    public string ProviderName { get; set; } = string.Empty;
    public string BaseUrl { get; set; } = string.Empty;
}

public class JobQueueItemResponse
{
    public string Id { get; set; } = string.Empty;
    public string JobName { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public class FixFileResultResponse
{
    public string Message { get; set; } = string.Empty;
    public int TotalFixed { get; set; }
}

