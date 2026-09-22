using System.Collections.Concurrent;
using MangaScrapper.Core.Common.Abstractions;
using Microsoft.Extensions.Logging;

namespace MangaScrapper.Core.Services;

/// <summary>
/// Thread-safe in-memory manager that keeps track of active chapter scraping jobs
/// and allows targeted or global cancellation.
/// </summary>
public sealed class ScrapingCancellationManager : IScrapingCancellationManager
{
    private readonly ConcurrentDictionary<Guid, (Guid MangaId, CancellationTokenSource Cts)> _activeTokens = new();
    private readonly ILogger<ScrapingCancellationManager> _logger;

    public ScrapingCancellationManager(ILogger<ScrapingCancellationManager> logger)
    {
        _logger = logger;
    }

    public CancellationTokenSource Register(Guid mangaId, Guid chapterId, CancellationToken parentToken)
    {
        var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(parentToken);
        _activeTokens[chapterId] = (mangaId, linkedCts);
        _logger.LogDebug("Registered scraping task for Manga={MangaId}, Chapter={ChapterId}", mangaId, chapterId);
        return linkedCts;
    }

    public void Unregister(Guid chapterId)
    {
        if (_activeTokens.TryRemove(chapterId, out var entry))
        {
            _logger.LogDebug("Unregistered scraping task for Chapter={ChapterId}", chapterId);
        }
    }

    public void Cancel(Guid? mangaId, Guid? chapterId, bool cancelAll = false)
    {
        if (cancelAll)
        {
            _logger.LogInformation("Cancelling all active scraping tasks ({Count} tasks found)", _activeTokens.Count);
            foreach (var kvp in _activeTokens)
            {
                try
                {
                    kvp.Value.Cts.Cancel();
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Error signalling cancellation to chapter {ChapterId}", kvp.Key);
                }
            }
            return;
        }

        if (chapterId.HasValue && _activeTokens.TryGetValue(chapterId.Value, out var specificEntry))
        {
            _logger.LogInformation("Cancelling specific scraping task for Chapter={ChapterId}", chapterId.Value);
            try
            {
                specificEntry.Cts.Cancel();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Error signalling cancellation to chapter {ChapterId}", chapterId.Value);
            }
            return;
        }

        if (mangaId.HasValue)
        {
            _logger.LogInformation("Cancelling all active scraping tasks for Manga={MangaId}", mangaId.Value);
            foreach (var kvp in _activeTokens)
            {
                if (kvp.Value.MangaId == mangaId.Value)
                {
                    try
                    {
                        kvp.Value.Cts.Cancel();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Error signalling cancellation to chapter {ChapterId}", kvp.Key);
                    }
                }
            }
        }
    }
}
