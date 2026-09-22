using NovaStack.Contracts.IntegrationEvents;

namespace MangaScrapper.Core.Common.Abstractions;

public record ScrapingProcessItem
{
    public string Id { get; init; } = string.Empty;
    public Guid MangaId { get; init; }
    public string MangaTitle { get; init; } = string.Empty;
    public Guid ChapterId { get; init; }
    public double ChapterNumber { get; init; }
    public int DownloadedPages { get; init; }
    public int TotalPages { get; init; }
    public int Percent { get; init; }
    public string Status { get; init; } = "InProgress"; // Queued, Starting, InProgress, Completed, Failed, Cancelled
    public DateTime StartedAt { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; init; } = DateTime.UtcNow;
}

/// <summary>
/// Service tracking active, queued, and recently finished scraping jobs for front-end visibility.
/// </summary>
public interface IScrapingProcessTracker
{
    void TrackProgress(ChapterScrapingProgressIntegrationEvent evt);
    void TrackQueued(Guid mangaId, string mangaTitle, Guid chapterId, double chapterNumber);
    void MarkCancelled(Guid? mangaId, Guid? chapterId, bool cancelAll = false);
    IReadOnlyList<ScrapingProcessItem> GetAllProcesses();
    void ClearFinished();
}
