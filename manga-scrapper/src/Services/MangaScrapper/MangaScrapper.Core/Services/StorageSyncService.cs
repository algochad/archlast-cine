using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Utils;
using NovaStack.Contracts.Responses;
using SkiaSharp;

namespace MangaScrapper.Core.Services;

public class StorageSyncService
{
    private readonly IMangaRepository _mangaRepository;
    private readonly ILogger<StorageSyncService> _logger;
    private readonly string _imageStoragePath;

    public StorageSyncService(
        IMangaRepository mangaRepository,
        ILogger<StorageSyncService> logger,
        IOptions<ScrapperSettings> settings)
    {
        _mangaRepository = mangaRepository;
        _logger = logger;
        _imageStoragePath = Path.IsPathRooted(settings.Value.ImageStoragePath)
            ? settings.Value.ImageStoragePath
            : Path.Combine(Directory.GetCurrentDirectory(), settings.Value.ImageStoragePath);
    }

    public async Task<StorageSyncReportResponse> SyncStorageUsageAsync(CancellationToken ct = default)
    {
        long totalThumbnailSize = 0;
        long totalPagesSize = 0;
        int updatedMangasCount = 0;
        int processedMangasCount = 0;
        var errors = new List<string>();

        int page = 1;
        const int pageSize = 25;

        while (true)
        {
            var paged = await _mangaRepository.GetPagedAsync("", null, "", "", "", "asc", page, pageSize, ct, excludePage: false);
            if (paged.Items.Count == 0) break;

            foreach (var manga in paged.Items)
            {
                try
                {
                    bool modified = false;

                    if (!string.IsNullOrEmpty(manga.LocalImageUrl))
                    {
                        var thumbPath = Path.Combine(_imageStoragePath, manga.LocalImageUrl.Replace("/", Path.DirectorySeparatorChar.ToString()));
                        if (File.Exists(thumbPath))
                        {
                            var size = new FileInfo(thumbPath).Length;
                            if (manga.ThumbnailSize != size)
                            {
                                manga.UpdateLocalImage(manga.LocalImageUrl, size);
                                modified = true;
                            }
                            totalThumbnailSize += size;
                        }
                    }

                    foreach (var chapter in manga.Chapters)
                    {
                        foreach (var p in chapter.Pages)
                        {
                            if (!string.IsNullOrEmpty(p.LocalImageUrl))
                            {
                                var pagePath = Path.Combine(_imageStoragePath, p.LocalImageUrl.Replace("/", Path.DirectorySeparatorChar.ToString()));
                                if (File.Exists(pagePath))
                                {
                                    var size = new FileInfo(pagePath).Length;
                                    totalPagesSize += size;

                                    int width = p.Width;
                                    int height = p.Height;

                                    if (p.Size != size || p.Width == 0 || p.Height == 0)
                                    {
                                        var dims = ImageDimensionReader.GetDimensions(pagePath);
                                        if (dims.Width > 0 && dims.Height > 0)
                                        {
                                            width = dims.Width;
                                            height = dims.Height;
                                        }
                                        else
                                        {
                                            // Fallback to SkiaSharp only if header reading failed
                                            try
                                            {
                                                using var stream = File.OpenRead(pagePath);
                                                using var codec = SKCodec.Create(stream);
                                                if (codec != null)
                                                {
                                                    width = codec.Info.Width;
                                                    height = codec.Info.Height;
                                                }
                                            }
                                            catch (Exception ex)
                                            {
                                                _logger.LogWarning(ex, "Failed to read image dimensions for {PagePath}", pagePath);
                                            }
                                        }

                                        if (p.Size != size || p.Width != width || p.Height != height)
                                        {
                                            p.UpdateLocalImage(p.LocalImageUrl, size, width, height);
                                            modified = true;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (modified)
                    {
                        await _mangaRepository.UpdateAsync(manga, ct);
                        updatedMangasCount++;
                    }

                    processedMangasCount++;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error syncing storage for manga {MangaTitle}", manga.Title);
                    errors.Add($"Error syncing {manga.Title}: {ex.Message}");
                }
            }

            if (paged.Items.Count < pageSize) break;
            page++;
        }

        return new StorageSyncReportResponse(
            processedMangasCount,
            updatedMangasCount,
            totalThumbnailSize,
            totalPagesSize,
            errors);
    }
}
