using System.Collections.Concurrent;
using MangaScrapper.Core.Common.Abstractions;
using NovaStack.Contracts.IntegrationEvents;

namespace MangaScrapper.Core.Services;

/// <summary>
/// Thread-safe in-memory tracker for background scraping processes.
/// Retains active processes and keeps recently completed/cancelled/failed processes for review.
/// </summary>
public sealed class ScrapingProcessTracker : IScrapingProcessTracker
{
    private readonly ConcurrentDictionary<Guid, ScrapingProcessItem> _processes = new();
    private static readonly TimeSpan FinishedRetention = TimeSpan.FromMinutes(3);

    public void TrackProgress(ChapterScrapingProgressIntegrationEvent evt)
    {
        PruneOldProcesses();

        _processes.AddOrUpdate(
            evt.ChapterId,
            addValueFactory: _ => new ScrapingProcessItem
            {
                Id = evt.ChapterId.ToString(),
                MangaId = evt.MangaId,
                MangaTitle = evt.MangaTitle,
                ChapterId = evt.ChapterId,
                ChapterNumber = evt.ChapterNumber,
                DownloadedPages = evt.DownloadedPages,
                TotalPages = evt.TotalPages,
                Percent = evt.Percent,
                Status = evt.Status,
                StartedAt = evt.OccurredOn,
                UpdatedAt = DateTime.UtcNow
            },
            updateValueFactory: (_, existing) => existing with
            {
                MangaTitle = string.IsNullOrWhiteSpace(existing.MangaTitle) ? evt.MangaTitle : existing.MangaTitle,
                DownloadedPages = evt.DownloadedPages,
                TotalPages = evt.TotalPages,
                Percent = evt.Percent,
                Status = evt.Status,
                UpdatedAt = DateTime.UtcNow
            });
    }

    public void TrackQueued(Guid mangaId, string mangaTitle, Guid chapterId, double chapterNumber)
    {
        PruneOldProcesses();

        _processes.TryAdd(chapterId, new ScrapingProcessItem
        {
            Id = chapterId.ToString(),
            MangaId = mangaId,
            MangaTitle = mangaTitle,
            ChapterId = chapterId,
            ChapterNumber = chapterNumber,
            DownloadedPages = 0,
            TotalPages = 0,
            Percent = 0,
            Status = "Queued",
            StartedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
    }

    public void MarkCancelled(Guid? mangaId, Guid? chapterId, bool cancelAll = false)
    {
        var now = DateTime.UtcNow;

        if (cancelAll)
        {
            foreach (var kvp in _processes)
            {
                if (kvp.Value.Status is "Queued" or "Starting" or "InProgress")
                {
                    _processes[kvp.Key] = kvp.Value with { Status = "Cancelled", UpdatedAt = now };
                }
            }
            return;
        }

        if (chapterId.HasValue && _processes.TryGetValue(chapterId.Value, out var specificItem))
        {
            if (specificItem.Status is "Queued" or "Starting" or "InProgress")
            {
                _processes[chapterId.Value] = specificItem with { Status = "Cancelled", UpdatedAt = now };
            }
            return;
        }

        if (mangaId.HasValue)
        {
            foreach (var kvp in _processes)
            {
                if (kvp.Value.MangaId == mangaId.Value && kvp.Value.Status is "Queued" or "Starting" or "InProgress")
                {
                    _processes[kvp.Key] = kvp.Value with { Status = "Cancelled", UpdatedAt = now };
                }
            }
        }
    }

    public IReadOnlyList<ScrapingProcessItem> GetAllProcesses()
    {
        PruneOldProcesses();
        return _processes.Values
            .OrderByDescending(p => p.Status is "InProgress" or "Starting" or "Queued")
            .ThenByDescending(p => p.UpdatedAt)
            .ToList();
    }

    public void ClearFinished()
    {
        foreach (var kvp in _processes)
        {
            if (kvp.Value.Status is "Completed" or "Cancelled" or "Failed")
            {
                _processes.TryRemove(kvp.Key, out _);
            }
        }
    }

    private void PruneOldProcesses()
    {
        var threshold = DateTime.UtcNow - FinishedRetention;
        foreach (var kvp in _processes)
        {
            if (kvp.Value.Status is "Completed" or "Cancelled" or "Failed" && kvp.Value.UpdatedAt < threshold)
            {
                _processes.TryRemove(kvp.Key, out _);
            }
        }
    }
}
