using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Scrapper.SearchJikan;

public record SearchJikanQuery(string Title) : IQuery<List<MangaSummaryResponse>>;

internal sealed class SearchJikanQueryHandler(IExternalMetadataService externalMetadataService)
    : IQueryHandler<SearchJikanQuery, List<MangaSummaryResponse>>
{
    public async Task<Result<List<MangaSummaryResponse>>> Handle(SearchJikanQuery query, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(query.Title))
            return new List<MangaSummaryResponse>();

        try
        {
            var mangas = await externalMetadataService.SearchJikanAsync(query.Title, ct);
            return mangas.Adapt<List<MangaSummaryResponse>>();
        }
        catch (Exception ex)
        {
            return Error.Failure("Jikan.SearchFailed", ex.Message);
        }
    }
}

public sealed class SearchJikanEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper")
            .WithTags("Scrapper")
            .RequireRateLimiting(RateLimitPolicies.Scraping);

        group.MapGet("/jikan/search", async (string title, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SearchJikanQuery(title), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("SearchJikanManga");
    }
}
