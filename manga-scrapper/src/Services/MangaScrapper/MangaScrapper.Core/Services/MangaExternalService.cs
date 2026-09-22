using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using NovaStack.Contracts.Requests;
using NovaStack.SharedKernel.Common;

using MangaScrapper.Core.Common.Abstractions;

namespace MangaScrapper.Core.Services;

public class MangaExternalService(
    ILogger<MangaExternalService> logger, 
    MeilisearchService meilisearchService,
    QdrantService qdrantService,
    IMangaRepository mangaRepository,
    IMangaMessagePublisher messagePublisher)
    : IMangaExternalRepository
{
    public async Task<PagedList<Manga>> SearchAsync(string? search, List<string>? genres, string? status, string? type, string sortBy, string orderBy, int page,
        int pageSize, bool? nsfw = null, CancellationToken ct = default)
    {
        var data = await meilisearchService.SearchAsync(search, genres, status, type, sortBy, orderBy, page, pageSize, nsfw, ct);
        var items = data.Items.Select(c=>c.Adapt<Manga>()).ToList();
        return new PagedList<Manga>(items, page, pageSize, data.TotalCount);
    }

    public async Task<PagedList<Manga>> QueryAdvancedAsync(
        MangaAdvancedFilter? filter,
        List<MangaSortOption>? sorts,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        var data = await meilisearchService.AdvancedSearchAsync(filter, sorts, page, pageSize, ct);
        var items = data.Items.Select(c => c.Adapt<Manga>()).ToList();
        return new PagedList<Manga>(items, page, pageSize, data.TotalCount);
    }

    public async Task<List<Manga>> GetRecomendationAsync(List<Guid> readingHistoryIds, int limit, CancellationToken ct = default)
    {
        var scoredList = await qdrantService.RecommendAsync(readingHistoryIds, limit, ct);
        if (scoredList.Count == 0) return new List<Manga>();
        var ids = scoredList.Select(x => x.Id).ToList();
        var mangas = await mangaRepository.GetByIdsAsync(ids, ct);
        return OrderMangasByScoredList(mangas, ids);
    }

    public async Task<List<Manga>> GetSimilarAsync(Guid mangaId, int limit, CancellationToken ct = default)
    {
        var scoredList = await qdrantService.SearchSimilarAsync(mangaId, limit, ct);
        if (scoredList.Count == 0) return new List<Manga>();
        var ids = scoredList.Select(x => x.Id).ToList();
        var mangas = await mangaRepository.GetByIdsAsync(ids, ct);
        return OrderMangasByScoredList(mangas, ids);
    }

    public async Task<List<Manga>> SemanticSearchAsync(string query, int limit, CancellationToken ct = default)
    {
        var scoredList = await qdrantService.SemanticSearchAsync(query, limit, ct);
        if (scoredList.Count == 0) return new List<Manga>();
        var ids = scoredList.Select(x => x.Id).ToList();
        var mangas = await mangaRepository.GetByIdsAsync(ids, ct);
        return OrderMangasByScoredList(mangas, ids);
    }

    public async Task<List<Manga>> GetSimilarFilteredAsync(
        Guid mangaId,
        string? status,
        string? type,
        List<string>? genres,
        int limit,
        CancellationToken ct = default)
    {
        var scoredList = await qdrantService.SearchSimilarFilteredAsync(mangaId, status, type, genres, limit, ct);
        if (scoredList.Count == 0) return new List<Manga>();
        var ids = scoredList.Select(x => x.Id).ToList();
        var mangas = await mangaRepository.GetByIdsAsync(ids, ct);
        return OrderMangasByScoredList(mangas, ids);
    }

    public async Task<List<Manga>> GetSimilarByCategoryAsync(
        List<string> categories,
        string? status = null,
        string? type = null,
        List<string>? genres = null,
        Guid? excludeMangaId = null,
        int limit = 10,
        CancellationToken ct = default)
    {
        var scoredList = await qdrantService.SimilarByCategoryAsync(categories, status, type, genres, excludeMangaId, limit, ct);
        if (scoredList.Count == 0) return new List<Manga>();
        var ids = scoredList.Select(x => x.Id).ToList();
        var mangas = await mangaRepository.GetByIdsAsync(ids, ct);
        return OrderMangasByScoredList(mangas, ids);
    }

    public async Task<List<Manga>> GetAdvancedRecommendationAsync(
        List<Guid> likedIds,
        List<Guid> dislikedIds,
        int limit,
        CancellationToken ct = default)
    {
        var scoredList = await qdrantService.RecommendAdvancedAsync(likedIds, dislikedIds, limit, ct);
        if (scoredList.Count == 0) return new List<Manga>();
        var ids = scoredList.Select(x => x.Id).ToList();
        var mangas = await mangaRepository.GetByIdsAsync(ids, ct);
        return OrderMangasByScoredList(mangas, ids);
    }

    private static List<Manga> OrderMangasByScoredList(List<Manga> mangas, List<Guid> orderedIds)
    {
        var dict = mangas.ToDictionary(m => m.Id.Value);
        var result = new List<Manga>(orderedIds.Count);
        foreach (var id in orderedIds)
        {
            if (dict.TryGetValue(id, out var manga))
            {
                result.Add(manga);
            }
        }
        return result;
    }
    

    public async Task IndexMangaAsync(Manga manga, CancellationToken ct = default)
    {
        await meilisearchService.IndexMangaAsync(manga, ct);
    }

    public async Task UpsertMangaAsync(Manga manga, CancellationToken ct = default)
    {
        await messagePublisher.PublishUpsertMangaQdrantAsync(manga.Id.Value, ct);
    }
}