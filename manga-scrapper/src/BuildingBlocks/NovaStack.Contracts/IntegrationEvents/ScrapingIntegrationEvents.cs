namespace NovaStack.Contracts.IntegrationEvents;

/// <summary>
/// Integration event published when a manga chapter needs its pages scraped.
/// Consumed by the Scrapper.Worker via RabbitMQ.
/// </summary>
public sealed record ScrapChapterPagesIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(ScrapChapterPagesIntegrationEvent);

    public Guid MangaId { get; init; }
    public string MangaTitle { get; init; } = string.Empty;
    public double ChapterNumber { get; init; }
    public string ChapterId { get; init; } = string.Empty;

    /// <summary>The provider key used to resolve the correct <c>IScrapperService</c> (e.g. "komiku", "kiryuu").</summary>
    public string Provider { get; init; } = string.Empty;

    public ScrapChapterPagesIntegrationEvent() { }

    public ScrapChapterPagesIntegrationEvent(
        Guid mangaId,
        string mangaTitle,
        double chapterNumber,
        string chapterId,
        string provider)
    {
        MangaId = mangaId;
        MangaTitle = mangaTitle;
        ChapterNumber = chapterNumber;
        ChapterId = chapterId;
        Provider = provider;
    }
}

/// <summary>
/// Integration event published when a manga is deleted.
/// Consumed by the Scrapper.Worker via RabbitMQ — handles file cleanup + removal from all stores.
/// </summary>
public sealed record DeleteMangaIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(DeleteMangaIntegrationEvent);

    public Guid MangaId { get; init; }
    public string MangaTitle { get; init; } = string.Empty;

    public DeleteMangaIntegrationEvent() { }

    public DeleteMangaIntegrationEvent(Guid mangaId, string mangaTitle)
    {
        MangaId = mangaId;
        MangaTitle = mangaTitle;
    }
}

/// <summary>
/// Integration event published when a chapter within a manga is deleted.
/// Consumed by the Scrapper.Worker via RabbitMQ — handles file cleanup + removal from MongoDB.
/// </summary>
public sealed record DeleteChapterIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(DeleteChapterIntegrationEvent);

    public Guid MangaId { get; init; }
    public string MangaTitle { get; init; } = string.Empty;
    public Guid ChapterId { get; init; }
    public double ChapterNumber { get; init; }

    public DeleteChapterIntegrationEvent() { }

    public DeleteChapterIntegrationEvent(Guid mangaId, string mangaTitle, Guid chapterId, double chapterNumber)
    {
        MangaId = mangaId;
        MangaTitle = mangaTitle;
        ChapterId = chapterId;
        ChapterNumber = chapterNumber;
    }
}

/// <summary>
/// Integration event published by Scrapper.Worker when chapter pages have been scraped and updated in MongoDB.
/// Consumed by MangaScrapper.Api to broadcast real-time SignalR notifications to connected clients.
/// </summary>
public sealed record ChapterPagesScrapedIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(ChapterPagesScrapedIntegrationEvent);

    public Guid MangaId { get; init; }
    public string MangaTitle { get; init; } = string.Empty;
    public Guid ChapterId { get; init; }
    public double ChapterNumber { get; init; }
    public int PageCount { get; init; }

    public ChapterPagesScrapedIntegrationEvent() { }

    public ChapterPagesScrapedIntegrationEvent(
        Guid mangaId,
        string mangaTitle,
        Guid chapterId,
        double chapterNumber,
        int pageCount)
    {
        MangaId = mangaId;
        MangaTitle = mangaTitle;
        ChapterId = chapterId;
        ChapterNumber = chapterNumber;
        PageCount = pageCount;
    }
}

/// <summary>
/// Integration event published by Scrapper.Worker during scraping to report live progress.
/// Consumed by MangaScrapper.Api to broadcast real-time progress bars to connected clients.
/// </summary>
public sealed record ChapterScrapingProgressIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(ChapterScrapingProgressIntegrationEvent);

    public Guid MangaId { get; init; }
    public string MangaTitle { get; init; } = string.Empty;
    public Guid ChapterId { get; init; }
    public double ChapterNumber { get; init; }
    public int DownloadedPages { get; init; }
    public int TotalPages { get; init; }
    public int Percent { get; init; }
    public string Status { get; init; } = "InProgress"; // "Starting", "InProgress", "Completed", "Failed"

    public ChapterScrapingProgressIntegrationEvent() { }

    public ChapterScrapingProgressIntegrationEvent(
        Guid mangaId,
        string mangaTitle,
        Guid chapterId,
        double chapterNumber,
        int downloadedPages,
        int totalPages,
        int percent,
        string status = "InProgress")
    {
        MangaId = mangaId;
        MangaTitle = mangaTitle;
        ChapterId = chapterId;
        ChapterNumber = chapterNumber;
        DownloadedPages = downloadedPages;
        TotalPages = totalPages;
        Percent = percent;
        Status = status;
    }
}

/// <summary>
/// Integration event published when a manga needs its embeddings generated and upserted to Qdrant.
/// Consumed exclusively by Scrapper.Worker via RabbitMQ.
/// </summary>
public sealed record UpsertMangaQdrantIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(UpsertMangaQdrantIntegrationEvent);

    public Guid MangaId { get; init; }

    public UpsertMangaQdrantIntegrationEvent() { }

    public UpsertMangaQdrantIntegrationEvent(Guid mangaId)
    {
        MangaId = mangaId;
    }
}

/// <summary>
/// Integration event published when an entire manga needs to be scraped from a provider.
/// Consumed by the Scrapper.Worker via RabbitMQ.
/// </summary>
public sealed record ScrapMangaIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(ScrapMangaIntegrationEvent);

    public string Provider { get; init; } = string.Empty;
    public string MangaUrl { get; init; } = string.Empty;
    public bool ScrapChapterPages { get; init; } = true;
    public string? LinkId { get; init; }

    public ScrapMangaIntegrationEvent() { }

    public ScrapMangaIntegrationEvent(string provider, string mangaUrl, bool scrapChapterPages = true, string? linkId = null)
    {
        Provider = provider;
        MangaUrl = mangaUrl;
        ScrapChapterPages = scrapChapterPages;
        LinkId = linkId;
    }
}

/// <summary>
/// Integration event published to cancel active and/or queued chapter scraping processes.
/// Consumed by the Scrapper.Worker via RabbitMQ.
/// </summary>
public sealed record CancelScrapingIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(CancelScrapingIntegrationEvent);

    public Guid? MangaId { get; init; }
    public Guid? ChapterId { get; init; }
    public bool CancelAll { get; init; }

    public CancelScrapingIntegrationEvent() { }

    public CancelScrapingIntegrationEvent(Guid? mangaId, Guid? chapterId, bool cancelAll = false)
    {
        MangaId = mangaId;
        ChapterId = chapterId;
        CancelAll = cancelAll;
    }
}

