using MangaScrapper.Core.ValueObjects;
using NovaStack.SharedKernel.Common;

namespace MangaScrapper.Core.Aggregates;

public class UserProgression : Entity<Guid>
{
    public string UserId { get; private set; }
    public MangaId MangaId { get; private set; }
    public DateTime LastReadAt { get; private set; }
    public int TotalReadingTime { get; private set; }
    public List<ChapterLog> ChapterLogs { get; private set; }

    private UserProgression(
        Guid id,
        string userId,
        MangaId mangaId,
        DateTime lastReadAt,
        int totalReadingTime,
        List<ChapterLog> chapterLogs)
        : base(id)
    {
        UserId = Guard.NotNullOrWhiteSpace(userId, nameof(userId));
        MangaId = mangaId;
        LastReadAt = lastReadAt;
        TotalReadingTime = totalReadingTime;
        ChapterLogs = chapterLogs;
    }

    public static UserProgression Create(string userId, MangaId mangaId, int totalReadingTime, List<ChapterLog> chapterLogs)
    {
        var id = Guid.CreateVersion7();
        return new UserProgression(id, userId, mangaId, DateTime.UtcNow, totalReadingTime, chapterLogs);
    }

    public static UserProgression Reconstitute(
        Guid id,
        string userId,
        MangaId mangaId,
        DateTime lastReadAt,
        int totalReadingTime,
        List<ChapterLog> chapterLogs)
    {
        return new UserProgression(id, userId, mangaId, lastReadAt, totalReadingTime, chapterLogs);
    }

    public void AddOrUpdateChapterLog(ChapterLog chapterLog)
    {
        var existingLog = ChapterLogs.FirstOrDefault(log => log.ChapterId == chapterLog.ChapterId);
        if (existingLog != null)
        {
            existingLog.LastReadPage = chapterLog.LastReadPage;
            existingLog.TotalPages = chapterLog.TotalPages;
            existingLog.IsCompleted = chapterLog.IsCompleted;
            existingLog.ReadingTimeSeconds = chapterLog.ReadingTimeSeconds;
            existingLog.LastReadAt = chapterLog.LastReadAt;
        }
        else
        {
            ChapterLogs.Add(chapterLog);
        }
    }

    public void UpdateProgression(ChapterLog chapterLog)
    {
        AddOrUpdateChapterLog(chapterLog);
        LastReadAt = chapterLog.LastReadAt;
        TotalReadingTime = ChapterLogs.Sum(log => log.ReadingTimeSeconds);
    }

    public class ChapterLog()
    {
        public Guid Id { get; set; } = Guid.CreateVersion7();
        public Guid ChapterId { get; set; }
        public double ChapterNumber { get; set; }
        public int LastReadPage { get; set; }
        public int TotalPages { get; set; }
        public bool IsCompleted { get; set; }
        public int ReadingTimeSeconds { get; set; }
        public DateTime LastReadAt { get; set; } = DateTime.UtcNow;

        private ChapterLog(Guid id, Guid chapterId, double chapterNumber, int lastReadPage, int totalPages, bool isCompleted, int readingTimeSeconds, DateTime lastReadAt) : this()
        {
            Id = id;
            ChapterId = chapterId;
            ChapterNumber = chapterNumber;
            LastReadPage = lastReadPage;
            TotalPages = totalPages;
            IsCompleted = isCompleted;
            ReadingTimeSeconds = readingTimeSeconds;
            LastReadAt = lastReadAt;
        }

        public static ChapterLog Reconstitute(Guid id, Guid chapterId, double chapterNumber, int lastReadPage, int totalPages, bool isCompleted, int readingTimeSeconds, DateTime lastReadAt)
        {
            return new ChapterLog(id, chapterId, chapterNumber, lastReadPage, totalPages, isCompleted, readingTimeSeconds, lastReadAt);
        }

        public static ChapterLog Create(Guid chapterId, double chapterNumber, int lastReadPage, int totalPages, bool isCompleted, int readingTimeSeconds)
        {
            return new ChapterLog(Guid.CreateVersion7(), chapterId, chapterNumber, lastReadPage, totalPages, isCompleted, readingTimeSeconds, DateTime.UtcNow);
        }
    }
}
