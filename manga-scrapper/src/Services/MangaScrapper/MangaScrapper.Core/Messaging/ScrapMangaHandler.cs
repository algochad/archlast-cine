using MangaScrapper.Core.Common.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="ScrapMangaIntegrationEvent"/> messages received from RabbitMQ.
/// Resolves the correct scraper by provider key and extracts the manga asynchronously in Scrapper.Worker.
/// </summary>
public sealed class ScrapMangaHandler(
    IServiceProvider serviceProvider,
    ILogger<ScrapMangaHandler> logger)
    : IIntegrationEventHandler<ScrapMangaIntegrationEvent>
{
    public async Task HandleAsync(ScrapMangaIntegrationEvent evt, CancellationToken ct = default)
    {
        try
        {
            logger.LogInformation(
                "Processing ScrapManga event: Provider={Provider}, Url={MangaUrl}, ScrapChapterPages={ScrapPages}",
                evt.Provider, evt.MangaUrl, evt.ScrapChapterPages);

            using var scope = serviceProvider.CreateScope();
            var scrapper = scope.ServiceProvider.GetKeyedService<IProviderScrapperService>(evt.Provider);
            if (scrapper is null)
            {
                logger.LogWarning("No IProviderScrapperService registered for provider key '{Provider}'. Dropping event.", evt.Provider);
                return;
            }

            var result = await scrapper.ExtractManga(evt.MangaUrl, ct, evt.ScrapChapterPages, evt.LinkId);
            if (result != null)
            {
                logger.LogInformation("Successfully extracted manga '{Title}' from provider '{Provider}'.", result.Title, evt.Provider);
            }
            else
            {
                logger.LogWarning("Extraction returned null for Provider={Provider}, Url={MangaUrl}.", evt.Provider, evt.MangaUrl);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to process ScrapManga event for Provider={Provider}, Url={MangaUrl}. Event dropped.", evt.Provider, evt.MangaUrl);
        }
    }
}
