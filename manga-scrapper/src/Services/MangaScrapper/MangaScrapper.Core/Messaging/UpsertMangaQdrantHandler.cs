using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.ValueObjects;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="UpsertMangaQdrantIntegrationEvent"/> messages received from RabbitMQ.
/// Consumed only in Scrapper.Worker to compute in-process ONNX embeddings and upsert points to Qdrant.
/// </summary>
public sealed class UpsertMangaQdrantHandler(
    IMangaRepository mangaRepository,
    QdrantService qdrantService,
    ILogger<UpsertMangaQdrantHandler> logger)
    : IIntegrationEventHandler<UpsertMangaQdrantIntegrationEvent>
{
    public async Task HandleAsync(UpsertMangaQdrantIntegrationEvent evt, CancellationToken ct = default)
    {
        logger.LogInformation("Processing UpsertMangaQdrant event for MangaId={MangaId}", evt.MangaId);

        try
        {
            var manga = await mangaRepository.GetByIdAsync(MangaId.From(evt.MangaId), ct);
            if (manga == null)
            {
                logger.LogWarning("Manga with ID {MangaId} not found in MongoDB. Skipping Qdrant upsert.", evt.MangaId);
                return;
            }

            await qdrantService.UpsertMangaDirectAsync(manga, ct);
            logger.LogInformation("Successfully completed Qdrant vector upsert for manga '{Title}' (ID: {Id}).", manga.Title, evt.MangaId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to upsert manga {MangaId} to Qdrant.", evt.MangaId);
        }
    }
}
