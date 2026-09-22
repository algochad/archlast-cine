using MangaScrapper.Core.Hubs;

namespace MangaScrapper.Core.Common.Abstractions;

/// <summary>
/// Broadcaster interface used by workers to stream chapter scraping progress and scraped events directly to the SignalR hub.
/// </summary>
public interface IScrapingProgressBroadcaster
{
    Task BroadcastProgressAsync(ChapterScrapingProgressPayload payload, CancellationToken ct = default);
    Task BroadcastPagesScrapedAsync(ChapterPagesScrapedPayload payload, CancellationToken ct = default);
}
