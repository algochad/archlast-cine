using MangaScrapper.Core.Common.Abstractions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.IntegrationEvents;

namespace MangaScrapper.Core.Hubs;

/// <summary>
/// SignalR Hub for real-time notifications related to manga and chapter updates.
/// </summary>
public sealed class MangaHub(
    ILogger<MangaHub> logger,
    IScrapingProcessTracker? processTracker = null) : Hub
{
    /// <summary>
    /// Invoked directly by background workers (e.g. Scrapper.Worker) to stream scraping progress over WebSocket/SignalR,
    /// updating the in-memory process tracker and broadcasting live to UI clients.
    /// </summary>
    public async Task ReportScrapingProgress(ChapterScrapingProgressPayload payload)
    {
        try
        {
            if (processTracker != null)
            {
                var evt = new ChapterScrapingProgressIntegrationEvent(
                    payload.MangaId,
                    payload.MangaTitle,
                    payload.ChapterId,
                    payload.ChapterNumber,
                    payload.DownloadedPages,
                    payload.TotalPages,
                    payload.Percent,
                    payload.Status)
                {
                    OccurredOn = payload.OccurredOn != default ? payload.OccurredOn : DateTime.UtcNow
                };
                processTracker.TrackProgress(evt);
            }

            var groupName = GetMangaGroupName(payload.MangaId);
            await Clients.Group(groupName).SendAsync("ChapterScrapingProgress", payload);
            await Clients.All.SendAsync("ChapterScrapingProgress", payload);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to broadcast ReportScrapingProgress for Manga={MangaId}, Chapter={ChapterId}", payload.MangaId, payload.ChapterId);
        }
    }

    /// <summary>
    /// Invoked directly by background workers when a chapter's pages have finished scraping and saved to DB.
    /// </summary>
    public async Task ReportChapterPagesScraped(ChapterPagesScrapedPayload payload)
    {
        try
        {
            var groupName = GetMangaGroupName(payload.MangaId);
            await Clients.Group(groupName).SendAsync("ChaptersUpdated", payload);
            await Clients.All.SendAsync("ChaptersUpdated", payload);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to broadcast ReportChapterPagesScraped for Manga={MangaId}, Chapter={ChapterId}", payload.MangaId, payload.ChapterId);
        }
    }
    /// <summary>
    /// Joins the group for a specific manga to receive localized chapter update notifications.
    /// </summary>
    public async Task JoinMangaGroup(string mangaId)
    {
        var groupName = GetMangaGroupName(mangaId);
        await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
        logger.LogDebug("Connection {ConnectionId} joined group {GroupName}", Context.ConnectionId, groupName);
    }

    /// <summary>
    /// Leaves the group for a specific manga.
    /// </summary>
    public async Task LeaveMangaGroup(string mangaId)
    {
        var groupName = GetMangaGroupName(mangaId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, groupName);
        logger.LogDebug("Connection {ConnectionId} left group {GroupName}", Context.ConnectionId, groupName);
    }

    public static string GetMangaGroupName(string mangaId) => $"manga-{mangaId.ToLowerInvariant()}";
    public static string GetMangaGroupName(Guid mangaId) => $"manga-{mangaId.ToString().ToLowerInvariant()}";

    public override Task OnConnectedAsync()
    {
        logger.LogDebug("SignalR client connected: {ConnectionId}", Context.ConnectionId);
        return base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        logger.LogDebug("SignalR client disconnected: {ConnectionId}", Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
