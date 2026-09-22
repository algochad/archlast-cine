using MangaScrapper.Core.Aggregates;
using NovaStack.Contracts.Responses;

namespace MangaScrapper.Core.Common.Abstractions;

public interface IExternalMetadataService
{
    Task<List<Manga>> SearchJikanAsync(string title, CancellationToken ct = default);
    Task<List<Manga>> SearchAnilistAsync(string title,int? anilistId=null, CancellationToken ct = default);
    Task<List<Manga>> SearchMangaUpdatesAsync(string title,int? mangaUpdateId=null, CancellationToken ct = default);
    Task<JikanMangaItem?> GetJikanMangaInfoAsync(string title, string type, CancellationToken ct = default);
    Task<JikanMangaItem?> GetJikanMangaInfoByIdAsync(int malId, CancellationToken ct = default);
}
