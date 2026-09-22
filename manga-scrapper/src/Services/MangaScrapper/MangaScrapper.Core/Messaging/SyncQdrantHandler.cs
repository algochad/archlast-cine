using MangaScrapper.Core.Services;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="SyncQdrantIntegrationEvent"/> messages received from RabbitMQ.
/// </summary>
public sealed class SyncQdrantHandler(
    QdrantService qdrantService,
    ILogger<SyncQdrantHandler> logger)
    : IIntegrationEventHandler<SyncQdrantIntegrationEvent>
{
    public async Task HandleAsync(SyncQdrantIntegrationEvent evt, CancellationToken ct = default)
    {
        logger.LogInformation("Starting background Qdrant sync...");
        
        try
        {
            await qdrantService.SyncAllAsync(ct);
            logger.LogInformation("Completed background Qdrant sync.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to complete background Qdrant sync.");
        }
    }
}
