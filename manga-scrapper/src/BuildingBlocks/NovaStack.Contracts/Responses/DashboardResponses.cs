namespace NovaStack.Contracts.Responses;

public record ScrapStatsResponse(DateTime Date, long TotalScrap);

public record DashboardStatisticResponse(
    long TotalManga = 0,
    long TotalChapters = 0,
    long TotalSourceProvider = 0,
    long ScrappedToday = 0,
    long ScrappedThisMonth = 0,
    long TotalQueue = 0,
    long TotalUnlinkedMetadata = 0,
    long TotalUnavailableMangaChapter = 0,
    long TotalStorageUsed = 0,
    List<ScrapStatsResponse>? MonthlyScrap = null,
    long TotalUsers = 0,
    long ActiveUsersToday = 0,
    long ActiveUsersThisMonth = 0,
    Dictionary<string, long>? MangaTypeBreakdown = null,
    Dictionary<string, long>? MangaStatusBreakdown = null,
    Dictionary<string, long>? ProviderChapterBreakdown = null)
{
    public List<ScrapStatsResponse> MonthlyScrap { get; init; } = MonthlyScrap ?? new();
    public Dictionary<string, long> MangaTypeBreakdown { get; init; } = MangaTypeBreakdown ?? new();
    public Dictionary<string, long> MangaStatusBreakdown { get; init; } = MangaStatusBreakdown ?? new();
    public Dictionary<string, long> ProviderChapterBreakdown { get; init; } = ProviderChapterBreakdown ?? new();
}

public record StorageSyncReportResponse(
    int ProcessedMangasCount,
    int UpdatedMangasCount,
    long TotalThumbnailSize,
    long TotalPagesSize,
    List<string> Errors)
{
    public long TotalSize => TotalThumbnailSize + TotalPagesSize;
}
