using NovaStack.Contracts.Responses;

namespace MangaScrapper.Core.Common.Abstractions;

public interface IProviderScrapperService
{
    Task<ScrapperMangaDocumentResponse> ExtractManga(string url, CancellationToken ct, bool scrapChapters = true, string? linkedId = null);
    Task<ScrapperMangaDocumentResponse> GetDetail(string url, CancellationToken ct);
    Task<List<SearchItemResponse>> SearchManga(ScrapperSearchRequest request, CancellationToken ct);
    Task<List<ProviderInfoResponse>> GetAllProvider();

}
