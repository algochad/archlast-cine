namespace MangaScrapper.Core.Aggregates;

public class DashboardStatistic
{
    public long TotalManga { get; set; }
    public long TotalChapters { get; set; }
    public long TotalSourceProvider { get; set; }
    public long ScrappedToday { get; set; }
    public long ScrappedThisMonth { get; set; }
    public long TotalQueue { get; set; }
    public long TotalUnlinkedMetadata { get; set; }
    public long TotalUnavailableMangaChapter { get; set; }
    public long TotalStorageUsed { get; set; }
    public List<ScrapStats> MonthlyScrap { get; set; } = new();
    public long TotalUsers { get; set; }
    public long ActiveUsersToday { get; set; }
    public long ActiveUsersThisMonth { get; set; }
    public Dictionary<string, long> MangaTypeBreakdown { get; set; } = new();
    public Dictionary<string, long> MangaStatusBreakdown { get; set; } = new();
    public Dictionary<string, long> ProviderChapterBreakdown { get; set; } = new();
}

public class ScrapStats
{
    public DateTime Date { get; set; }
    public long TotalScrap { get; set; }
}