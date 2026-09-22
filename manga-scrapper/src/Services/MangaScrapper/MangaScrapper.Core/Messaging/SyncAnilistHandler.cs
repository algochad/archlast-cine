using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Messaging;

/// <summary>
/// Handles <see cref="SyncAnilistIntegrationEvent"/> messages received from RabbitMQ.
/// Syncs all manga that have anilistId using UpdateFromAnilist.
/// </summary>
public sealed class SyncAnilistHandler(
    IMangaRepository mangaRepository,
    IExternalMetadataService externalMetadataService,
    IMangaExternalRepository mangaExternalRepository,
    ILogger<SyncAnilistHandler> logger)
    : IIntegrationEventHandler<SyncAnilistIntegrationEvent>
{
    public async Task HandleAsync(SyncAnilistIntegrationEvent evt, CancellationToken ct = default)
    {
        logger.LogInformation("Starting background AniList metadata sync...");

        try
        {
            var mangas = await mangaRepository.GetWithAnilistAsync(ct);
            logger.LogInformation("Found {Count} manga with AniList IDs to sync.", mangas.Count);

            int updatedCount = 0;
            foreach (var manga in mangas)
            {
                if (ct.IsCancellationRequested) break;

                try
                {
                    var anilistResults = await externalMetadataService.SearchAnilistAsync(manga.Title, manga.AnilistId, ct);
                    var matched = anilistResults.FirstOrDefault();

                    if (matched != null)
                    {
                        manga.UpdateFromAnilist(matched);
                        await mangaRepository.UpdateAsync(manga, ct);

                        try
                        {
                            await mangaExternalRepository.IndexMangaAsync(manga, ct);
                        }
                        catch (Exception ex)
                        {
                            logger.LogWarning(ex, "Failed to re-index manga {Id} to Meilisearch during AniList sync.", manga.Id.Value);
                        }

                        try
                        {
                            await mangaExternalRepository.UpsertMangaAsync(manga, ct);
                        }
                        catch (Exception ex)
                        {
                            logger.LogWarning(ex, "Failed to upsert manga {Id} to Qdrant during AniList sync.", manga.Id.Value);
                        }

                        updatedCount++;
                    }

                    // Respect AniList API rate limit (90 requests/minute)
                    await Task.Delay(500, ct);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to sync AniList metadata for manga '{Title}' (AnilistId: {AnilistId}).", manga.Title, manga.AnilistId);
                }
            }

            logger.LogInformation("Completed background AniList sync. Successfully updated {UpdatedCount}/{TotalCount} manga.", updatedCount, mangas.Count);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to complete background AniList metadata sync.");
        }
    }
}
