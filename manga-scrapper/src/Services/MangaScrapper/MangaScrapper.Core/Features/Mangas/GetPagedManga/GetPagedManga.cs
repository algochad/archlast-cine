using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.GetPagedManga;

public record GetPagedMangaQuery(
    string? Search = null,
    List<string>? Genres = null,
    string? Status = null,
    string? Type = null,
    int Page = 1,
    int PageSize = 10,
    string? SortBy = "updatedAt",
    string? OrderBy = "desc",
    bool? Nsfw = false) : IQuery<PagedResponse<MangaSummaryResponse>>;

public sealed class GetPagedMangaQueryHandler(
    IMangaRepository mangaRepository,
    IMangaExternalRepository mangaExternalRepository)
    : IQueryHandler<GetPagedMangaQuery, PagedResponse<MangaSummaryResponse>>
{
    public async Task<Result<PagedResponse<MangaSummaryResponse>>> Handle(
        GetPagedMangaQuery query,
        CancellationToken ct)
    {
        var data = await mangaExternalRepository.SearchAsync(
            query.Search,
            query.Genres,
            query.Status,
            query.Type,
            query.SortBy,
            query.OrderBy,
            query.Page,
            query.PageSize,
            query.Nsfw,
            ct);
        

        return PagedResponse<MangaSummaryResponse>.Create(
            data.Items.Select(x=>x.Adapt<MangaSummaryResponse>()),
            data.Page,
            data.PageSize,
            data.TotalCount);
    }
}

public sealed class GetPagedMangaEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga", HandleAsync)
            .WithName("GetPagedManga")
            .WithSummary("Get paged list of manga")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.Default)
            .Produces<ApiResponse<PagedResponse<MangaSummaryResponse>>>();
    }

    private static async Task<IResult> HandleAsync(
        ISender sender,
        CancellationToken ct,
        string? search = null,
        string[]? genres = null,
        string? status = null,
        string? type = null,
        int page = 1,
        int pageSize = 10,
        string? sortBy = "updatedAt",
        string? orderBy = "desc",
        bool? nsfw = false)
    {
        var genresList = genres?.ToList();
        var query = new GetPagedMangaQuery(search, genresList, status, type, page, pageSize, sortBy, orderBy, nsfw);
        var result = await sender.Send(query, ct);

        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value))
            : result.Error.ToHttpResult();
    }
}
