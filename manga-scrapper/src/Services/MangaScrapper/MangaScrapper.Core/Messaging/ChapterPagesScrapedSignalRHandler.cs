using MangaScrapper.Core.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="ChapterPagesScrapedIntegrationEvent"/> on the API host and broadcasts
/// real-time SignalR notifications to connected clients to trigger a refresh of chapter lists.
/// </summary>
public sealed class ChapterPagesScrapedSignalRHandler(
    IHubContext<MangaHub> hubContext,
    ILogger<ChapterPagesScrapedSignalRHandler> logger)
    : IIntegrationEventHandler<ChapterPagesScrapedIntegrationEvent>
{
    public async Task HandleAsync(ChapterPagesScrapedIntegrationEvent evt, CancellationToken ct = default)
    {
        try
        {
            logger.LogInformation(
                "Broadcasting SignalR ChapterPagesScraped event for Manga={MangaTitle} ({MangaId}), Chapter={ChapterNumber}, Pages={PageCount}",
                evt.MangaTitle, evt.MangaId, evt.ChapterNumber, evt.PageCount);

            var payload = new
            {
                mangaId = evt.MangaId,
                mangaTitle = evt.MangaTitle,
                chapterId = evt.ChapterId,
                chapterNumber = evt.ChapterNumber,
                pageCount = evt.PageCount,
                occurredOn = evt.OccurredOn
            };

            // Broadcast to the specific manga group as well as all connected clients
            var groupName = MangaHub.GetMangaGroupName(evt.MangaId);
            await hubContext.Clients.Group(groupName).SendAsync("ChaptersUpdated", payload, ct);
            await hubContext.Clients.All.SendAsync("ChaptersUpdated", payload, ct);

            logger.LogInformation(
                "SignalR broadcast 'ChaptersUpdated' successfully sent for MangaId={MangaId}, ChapterId={ChapterId}",
                evt.MangaId, evt.ChapterId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to broadcast SignalR notification for ChapterPagesScraped event: MangaId={MangaId}", evt.MangaId);
        }
    }
}
