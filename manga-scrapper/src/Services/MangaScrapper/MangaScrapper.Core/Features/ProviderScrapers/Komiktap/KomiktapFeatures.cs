using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.ProviderScrapers.Komiktap;

public record ScrapKomiktapMangaCommand(string MangaUrl, bool ScrapChapterPages = true, string? LinkId = null) : ICommand<ScrapperMangaDocumentResponse>;
public record GetKomiktapDetailQuery(string MangaUrl) : IQuery<ScrapperMangaDocumentResponse>;
public record SearchKomiktapQuery(ScrapperSearchRequest Request) : IQuery<List<SearchItemResponse>>;

internal sealed class ScrapKomiktapMangaCommandHandler(IMangaMessagePublisher messagePublisher)
    : ICommandHandler<ScrapKomiktapMangaCommand, ScrapperMangaDocumentResponse>
{
    public async Task<Result<ScrapperMangaDocumentResponse>> Handle(ScrapKomiktapMangaCommand command, CancellationToken ct)
    {
        await messagePublisher.PublishScrapMangaAsync("komiktap", command.MangaUrl, command.ScrapChapterPages, command.LinkId, ct);
        return new ScrapperMangaDocumentResponse { Url = command.MangaUrl };
    }
}

internal sealed class GetKomiktapDetailQueryHandler([FromKeyedServices("komiktap")] IProviderScrapperService scrapperService)
    : IQueryHandler<GetKomiktapDetailQuery, ScrapperMangaDocumentResponse>
{
    public async Task<Result<ScrapperMangaDocumentResponse>> Handle(GetKomiktapDetailQuery query, CancellationToken ct)
    {
        var manga = await scrapperService.GetDetail(query.MangaUrl, ct);
        return manga;
    }
}

internal sealed class SearchKomiktapQueryHandler([FromKeyedServices("komiktap")] IProviderScrapperService scrapperService)
    : IQueryHandler<SearchKomiktapQuery, List<SearchItemResponse>>
{
    public async Task<Result<List<SearchItemResponse>>> Handle(SearchKomiktapQuery query, CancellationToken ct)
    {
        var results = await scrapperService.SearchManga(query.Request, ct);
        return results;
    }
}

public sealed class KomiktapEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper")
            .WithTags("ProviderScrapers")
            .RequireRateLimiting(RateLimitPolicies.Scraping);

        group.MapPost("/komiktap", async (ProviderScrapMangaRequest req, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new ScrapKomiktapMangaCommand(req.MangaUrl, req.ScrapChapterPages, req.LinkId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });

        group.MapGet("/komiktap/detail", async (string mangaUrl, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetKomiktapDetailQuery(mangaUrl), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });

        group.MapGet("/komiktap/search", async ([AsParameters] ScrapperSearchRequest req, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SearchKomiktapQuery(req), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });
    }
}
