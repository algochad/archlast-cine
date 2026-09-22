using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Scrapper.SearchMangaUpdates;

public record SearchMangaUpdatesQuery(string Title) : IQuery<List<MangaSummaryResponse>>;

internal sealed class SearchMangaUpdatesQueryHandler(IExternalMetadataService externalMetadataService)
    : IQueryHandler<SearchMangaUpdatesQuery, List<MangaSummaryResponse>>
{
    public async Task<Result<List<MangaSummaryResponse>>> Handle(SearchMangaUpdatesQuery query, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(query.Title))
            return new List<MangaSummaryResponse>();

        try
        {
            var mangas = await externalMetadataService.SearchMangaUpdatesAsync(query.Title,null, ct);
            return mangas.Adapt<List<MangaSummaryResponse>>();
        }
        catch (Exception ex)
        {
            return Error.Failure("MangaUpdates.SearchFailed", ex.Message);
        }
    }
}

public sealed class SearchMangaUpdatesEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper")
            .WithTags("Scrapper")
            .RequireRateLimiting(RateLimitPolicies.Scraping);

        group.MapGet("/mangaupdates/search", async (string title, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SearchMangaUpdatesQuery(title), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("SearchMangaUpdates");
    }
}
