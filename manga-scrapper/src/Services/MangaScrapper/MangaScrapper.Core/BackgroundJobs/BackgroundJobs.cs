using System.ComponentModel;
using Hangfire;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Scrapers;
using MangaScrapper.Core.ValueObjects;

namespace MangaScrapper.Core.BackgroundJobs;

public class MeiliSyncJob(
    IServiceProvider serviceProvider,
    ILogger<MeiliSyncJob> logger)
{
    [Queue("default")]
    [DisplayName("Sync Manga to Meilisearch")]
    public async Task ExecuteAsync(CancellationToken ct)
    {
        logger.LogInformation("Starting Meilisearch sync job...");
        using var scope = serviceProvider.CreateScope();
        var meilisearchService = scope.ServiceProvider.GetRequiredService<Services.MeilisearchService>();
        await meilisearchService.SyncAllAsync(ct);
        logger.LogInformation("Meilisearch sync job completed.");
    }
}

public class DeleteMangaJob(
    IServiceProvider serviceProvider,
    ILogger<DeleteMangaJob> logger,
    Microsoft.Extensions.Options.IOptions<Configuration.ScrapperSettings> settings)
{
    private readonly string _imageStoragePath = Path.IsPathRooted(settings.Value.ImageStoragePath)
        ? settings.Value.ImageStoragePath
        : Path.Combine(Directory.GetCurrentDirectory(), settings.Value.ImageStoragePath);

    [Queue("default")]
    [DisplayName("Deleting Manga: {1}")]
    public async Task ExecuteAsync(Guid mangaId, string mangaTitle, CancellationToken ct)
    {
        logger.LogInformation("Starting deletion for manga: {MangaTitle} (ID: {MangaId})", mangaTitle, mangaId);

        using var scope = serviceProvider.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IMangaRepository>();
        var meilisearch = scope.ServiceProvider.GetRequiredService<Services.MeilisearchService>();
        var qdrant = scope.ServiceProvider.GetRequiredService<Services.QdrantService>();

        var manga = await repo.GetByIdAsync(MangaId.From(mangaId), ct);
        if (manga == null)
        {
            logger.LogWarning("Manga with ID {MangaId} not found. It might have been deleted already.", mangaId);
            return;
        }

        var cleanTitle = GetCleanTitle(manga.Title);
        var mangaDir = Path.Combine(_imageStoragePath, cleanTitle);

        if (Directory.Exists(mangaDir))
        {
            try { Directory.Delete(mangaDir, true); logger.LogInformation("Deleted directory: {MangaDir}", mangaDir); }
            catch (Exception ex) { logger.LogError(ex, "Error deleting directory: {MangaDir}", mangaDir); }
        }

        if (!string.IsNullOrEmpty(manga.LocalImageUrl))
        {
            var thumbnailPath = Path.Combine(_imageStoragePath, manga.LocalImageUrl);
            if (File.Exists(thumbnailPath))
            {
                try { File.Delete(thumbnailPath); logger.LogInformation("Deleted thumbnail: {ThumbnailPath}", thumbnailPath); }
                catch (Exception ex) { logger.LogError(ex, "Error deleting thumbnail: {ThumbnailPath}", thumbnailPath); }
            }
        }

        // Delete from all stores
        await repo.DeleteAsync(MangaId.From(mangaId), ct);
        await meilisearch.DeleteMangaAsync(mangaId, ct);
        await qdrant.DeleteMangaAsync(mangaId, ct);

        logger.LogInformation("Finished deletion for manga: {MangaTitle}", mangaTitle);
    }

    private static string GetCleanTitle(string title)
    {
        var invalidChars = Path.GetInvalidFileNameChars().Union(new[] { '?', '*', ':', '|', '<', '>', '"' }).ToArray();
        var cleaned = string.Concat(title.Split(invalidChars)).TrimEnd('.', ' ');
        return string.IsNullOrEmpty(cleaned) ? "manga" : cleaned;
    }
}

public class LatestChapterScrapingJob(
    IServiceProvider serviceProvider,
    ILogger<LatestChapterScrapingJob> logger)
{
    [Queue("default")]
    public async Task ExecuteAsync(int scrapLastTotalPage, string provider, CancellationToken ct)
    {
        using var scope = serviceProvider.CreateScope();

        // Resolve by provider name string
        IScrapperService? scrapperService = provider.ToLowerInvariant() switch
        {
            "komiku" => scope.ServiceProvider.GetKeyedService<IScrapperService>("komiku"),
            "kiryuu" => scope.ServiceProvider.GetKeyedService<IScrapperService>("kiryuu"),
            "komikcast" => scope.ServiceProvider.GetKeyedService<IScrapperService>("komikcast"),
            "mangadex" => scope.ServiceProvider.GetKeyedService<IScrapperService>("mangadex"),
            "komiktap" => scope.ServiceProvider.GetKeyedService<IScrapperService>("komiktap"),
            "manhwadesu" => scope.ServiceProvider.GetKeyedService<IScrapperService>("manhwadesu"),
            "doujindesu" => scope.ServiceProvider.GetKeyedService<IScrapperService>("doujindesu"),
            "softkomik" => scope.ServiceProvider.GetKeyedService<IScrapperService>("softkomik"),
            _ => null
        };

        if (scrapperService == null)
        {
            logger.LogWarning("Provider {Provider} is not supported.", provider);
            return;
        }

        for (int p = 1; p <= scrapLastTotalPage; p++)
        {
            var searchItems = await scrapperService.SearchManga(new Configuration.SearchRequest { Page = p }, ct);
            foreach (var item in searchItems)
            {
                if (item.MangaId != null && item.LatestChapterNumber > item.CurrentChapterNumber)
                {
                    logger.LogInformation("Found new chapter for {Title} on {Provider}", item.Title, provider);
                    try { await scrapperService.ExtractManga(item.DetailUrl, ct, false, item.MangaId); }
                    catch (Exception ex) { logger.LogError(ex, "Failed to extract new chapters for {Title}", item.Title); }
                }
            }
        }
    }
}
