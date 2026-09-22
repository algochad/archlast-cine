using MangaScrapper.Core.Services;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="SyncMeilisearchIntegrationEvent"/> messages received from RabbitMQ.
/// </summary>
public sealed class SyncMeilisearchHandler(
    MeilisearchService meilisearchService,
    ILogger<SyncMeilisearchHandler> logger)
    : IIntegrationEventHandler<SyncMeilisearchIntegrationEvent>
{
    public async Task HandleAsync(SyncMeilisearchIntegrationEvent evt, CancellationToken ct = default)
    {
        logger.LogInformation("Starting background Meilisearch sync...");
        
        try
        {
            await meilisearchService.SyncAllAsync(ct);
            logger.LogInformation("Completed background Meilisearch sync.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to complete background Meilisearch sync.");
        }
    }
}
