using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="DeleteChapterIntegrationEvent"/> messages received from RabbitMQ.
/// Deletes local files, and removes the chapter from MongoDB.
/// </summary>
public sealed class DeleteChapterHandler(
    IServiceProvider serviceProvider,
    IOptions<ScrapperSettings> settings,
    ILogger<DeleteChapterHandler> logger)
    : IIntegrationEventHandler<DeleteChapterIntegrationEvent>
{
    private readonly string _imageStoragePath = Path.IsPathRooted(settings.Value.ImageStoragePath)
        ? settings.Value.ImageStoragePath
        : Path.Combine(Directory.GetCurrentDirectory(), settings.Value.ImageStoragePath);

    public async Task HandleAsync(DeleteChapterIntegrationEvent evt, CancellationToken ct = default)
    {
        try
        {
            logger.LogInformation(
                "Processing DeleteChapter event: MangaId={MangaId}, ChapterId={ChapterId}",
                evt.MangaId, evt.ChapterId);

            using var scope = serviceProvider.CreateScope();
            var repo = scope.ServiceProvider.GetRequiredService<IMangaRepository>();

            var manga = await repo.GetByIdAsync(MangaId.From(evt.MangaId), ct);
            if (manga == null)
            {
                logger.LogWarning(
                    "Manga with ID {MangaId} not found. Cannot delete chapter.", evt.MangaId);
                return;
            }

            var chapter = manga.Chapters.FirstOrDefault(c => c.Id.Value == evt.ChapterId);
            if (chapter == null)
            {
                logger.LogWarning(
                    "Chapter {ChapterId} not found in Manga {MangaId}.", evt.ChapterId, evt.MangaId);
                return;
            }

            // Delete local chapter directory
            var cleanTitle = GetCleanTitle(manga.Title);
            var chapterDir = Path.Combine(_imageStoragePath, cleanTitle, chapter.Number.ToString());

            if (Directory.Exists(chapterDir))
            {
                try
                {
                    Directory.Delete(chapterDir, recursive: true);
                    logger.LogInformation("Deleted chapter directory: {ChapterDir}", chapterDir);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Error deleting chapter directory: {ChapterDir}", chapterDir);
                }
            }

            manga.DeleteChapter(ChapterId.From(evt.ChapterId));
            await repo.UpdateAsync(manga, ct);

            var progressionRepo = scope.ServiceProvider.GetRequiredService<IUserProgressionRepository>();
            await progressionRepo.RemoveChapterLogAsync(evt.MangaId, evt.ChapterId, ct);

            logger.LogInformation(
                "Finished DeleteChapter event: MangaId={MangaId}, ChapterId={ChapterId}",
                evt.MangaId, evt.ChapterId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to process DeleteChapter event for MangaId={MangaId}, ChapterId={ChapterId}. Event discarded.", evt.MangaId, evt.ChapterId);
        }
    }

    private static string GetCleanTitle(string title)
    {
        var invalidChars = Path.GetInvalidFileNameChars()
            .Union(new[] { '?', '*', ':', '|', '<', '>', '"' })
            .ToArray();
        var cleaned = string.Concat(title.Split(invalidChars)).TrimEnd('.', ' ');
        return string.IsNullOrEmpty(cleaned) ? "manga" : cleaned;
    }
}
