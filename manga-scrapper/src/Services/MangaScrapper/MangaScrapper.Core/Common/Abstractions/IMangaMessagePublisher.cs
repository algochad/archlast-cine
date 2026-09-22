namespace MangaScrapper.Core.Common.Abstractions;

public interface IMangaMessagePublisher
{
    Task PublishMangaDeletedAsync(Guid mangaId, string title, CancellationToken ct = default);
    Task PublishChapterDeletedAsync(Guid mangaId, string mangaTitle, Guid chapterId, double chapterNumber, CancellationToken ct = default);
    Task PublishUpsertMangaQdrantAsync(Guid mangaId, CancellationToken ct = default);
    Task PublishScrapMangaAsync(string provider, string mangaUrl, bool scrapChapterPages = true, string? linkId = null, CancellationToken ct = default);
}
