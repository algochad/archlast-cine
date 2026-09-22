using MangaScrapper.Core.Common.Abstractions;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="CancelScrapingIntegrationEvent"/> received from RabbitMQ.
/// Signals cancellation to in-progress chapter scraping tasks in Scrapper.Worker.
/// </summary>
public sealed class CancelScrapingHandler(
    IScrapingCancellationManager cancellationManager,
    IScrapingProcessTracker? processTracker,
    ILogger<CancelScrapingHandler> logger)
    : IIntegrationEventHandler<CancelScrapingIntegrationEvent>
{
    public Task HandleAsync(CancelScrapingIntegrationEvent evt, CancellationToken ct = default)
    {
        try
        {
            logger.LogInformation(
                "Handling CancelScraping event: MangaId={MangaId}, ChapterId={ChapterId}, CancelAll={CancelAll}",
                evt.MangaId, evt.ChapterId, evt.CancelAll);

            cancellationManager.Cancel(evt.MangaId, evt.ChapterId, evt.CancelAll);
            processTracker?.MarkCancelled(evt.MangaId, evt.ChapterId, evt.CancelAll);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error processing CancelScraping event for MangaId={MangaId}, ChapterId={ChapterId}", evt.MangaId, evt.ChapterId);
        }

        return Task.CompletedTask;
    }
}
