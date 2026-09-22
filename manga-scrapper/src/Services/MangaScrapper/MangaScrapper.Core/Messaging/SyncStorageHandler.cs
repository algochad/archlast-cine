using MangaScrapper.Core.Services;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="SyncStorageIntegrationEvent"/> messages received from RabbitMQ.
/// </summary>
public sealed class SyncStorageHandler(
    StorageSyncService syncService,
    ILogger<SyncStorageHandler> logger)
    : IIntegrationEventHandler<SyncStorageIntegrationEvent>
{
    public async Task HandleAsync(SyncStorageIntegrationEvent evt, CancellationToken ct = default)
    {
        logger.LogInformation("Starting background storage sync...");
        
        try
        {
            var report = await syncService.SyncStorageUsageAsync(ct);
            logger.LogInformation("Completed storage sync. Processed: {Processed}, Updated: {Updated}, Errors: {Errors}",
                report.ProcessedMangasCount, report.UpdatedMangasCount, report.Errors.Count);
            
            if (report.Errors.Count > 0)
            {
                foreach (var error in report.Errors)
                {
                    logger.LogWarning("Storage sync error: {Error}", error);
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to complete background storage sync.");
        }
    }
}
