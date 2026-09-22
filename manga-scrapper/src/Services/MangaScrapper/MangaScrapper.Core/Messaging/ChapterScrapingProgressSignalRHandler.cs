using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="ChapterScrapingProgressIntegrationEvent"/> on the API host and broadcasts
/// real-time SignalR progress notifications to connected clients for live progress bars.
/// </summary>
public sealed class ChapterScrapingProgressSignalRHandler(
    IHubContext<MangaHub> hubContext,
    ILogger<ChapterScrapingProgressSignalRHandler> logger,
    IScrapingProcessTracker? processTracker = null)
    : IIntegrationEventHandler<ChapterScrapingProgressIntegrationEvent>
{
    public async Task HandleAsync(ChapterScrapingProgressIntegrationEvent evt, CancellationToken ct = default)
    {
        try
        {
            processTracker?.TrackProgress(evt);

            var payload = new
            {
                mangaId = evt.MangaId,
                mangaTitle = evt.MangaTitle,
                chapterId = evt.ChapterId,
                chapterNumber = evt.ChapterNumber,
                downloadedPages = evt.DownloadedPages,
                totalPages = evt.TotalPages,
                percent = evt.Percent,
                status = evt.Status,
                occurredOn = evt.OccurredOn
            };

            var groupName = MangaHub.GetMangaGroupName(evt.MangaId);
            await hubContext.Clients.Group(groupName).SendAsync("ChapterScrapingProgress", payload, ct);
            await hubContext.Clients.All.SendAsync("ChapterScrapingProgress", payload, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to broadcast ChapterScrapingProgress SignalR notification: MangaId={MangaId}, ChapterId={ChapterId}", evt.MangaId, evt.ChapterId);
        }
    }
}
