using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.GetTrending;

public record GetTrendingQuery(string? Search, List<string>? Genres, string? Status, string? Type, int Page = 1, int PageSize = 10) : IQuery<PagedResponse<MangaSummaryResponse>>;

internal sealed class GetTrendingQueryHandler(IMangaRepository repository)
    : IQueryHandler<GetTrendingQuery, PagedResponse<MangaSummaryResponse>>
{
    public async Task<Result<PagedResponse<MangaSummaryResponse>>>Handle(GetTrendingQuery request, CancellationToken cancellationToken)
    {
        var data = await repository.GetTrendingAsync(request.Search, request.Genres, request.Status,request.Type, request.Page, request.PageSize,cancellationToken);
        return PagedResponse<MangaSummaryResponse>.Create(data.Items.Select(x=>x.Adapt<MangaSummaryResponse>()),request.Page,request.PageSize,data.TotalCount);
    }
}


//endpoint
public sealed class GetTrendingQueryEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/trending", HandleAsync)
            .WithName("GetTrending")
            .WithSummary("Get Trending Manga")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.Default)
            .Produces<ApiResponse<PagedResponse<MangaSummaryResponse>>>();
    }

    private static async Task<IResult> HandleAsync(ISender sender, CancellationToken ct, string? search, string[]?  genres, string? status, string? type, int page=1, int pageSize = 10)
    {
        var result = await sender.Send(new GetTrendingQuery(search,genres?.ToList(),status,type,page,pageSize), ct);
        return result.IsSuccess ? Results.Ok(ApiResponse.Ok(result.Value)) : result.Error.ToHttpResult();
    }
}
