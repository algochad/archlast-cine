namespace MangaScrapper.Core.Hubs;

/// <summary>
/// Payload sent over SignalR representing real-time chapter scraping progress.
/// </summary>
public sealed class ChapterScrapingProgressPayload
{
    public Guid MangaId { get; set; }
    public string MangaTitle { get; set; } = string.Empty;
    public Guid ChapterId { get; set; }
    public double ChapterNumber { get; set; }
    public int DownloadedPages { get; set; }
    public int TotalPages { get; set; }
    public int Percent { get; set; }
    public string Status { get; set; } = "InProgress";
    public DateTime OccurredOn { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Payload sent over SignalR representing completion of scraping and saving of chapter pages.
/// </summary>
public sealed class ChapterPagesScrapedPayload
{
    public Guid MangaId { get; set; }
    public string MangaTitle { get; set; } = string.Empty;
    public Guid ChapterId { get; set; }
    public double ChapterNumber { get; set; }
    public int PageCount { get; set; }
    public DateTime OccurredOn { get; set; } = DateTime.UtcNow;
}
