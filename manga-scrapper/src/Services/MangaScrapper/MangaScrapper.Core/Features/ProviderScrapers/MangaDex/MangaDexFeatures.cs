using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.ProviderScrapers.MangaDex;

public record ScrapMangaDexMangaCommand(string MangaUrl, bool ScrapChapterPages = true, string? LinkId = null) : ICommand<ScrapperMangaDocumentResponse>;
public record GetMangaDexDetailQuery(string MangaUrl) : IQuery<ScrapperMangaDocumentResponse>;
public record SearchMangaDexQuery(ScrapperSearchRequest Request) : IQuery<List<SearchItemResponse>>;

internal sealed class ScrapMangaDexMangaCommandHandler(IMangaMessagePublisher messagePublisher)
    : ICommandHandler<ScrapMangaDexMangaCommand, ScrapperMangaDocumentResponse>
{
    public async Task<Result<ScrapperMangaDocumentResponse>> Handle(ScrapMangaDexMangaCommand command, CancellationToken ct)
    {
        await messagePublisher.PublishScrapMangaAsync("mangadex", command.MangaUrl, command.ScrapChapterPages, command.LinkId, ct);
        return new ScrapperMangaDocumentResponse { Url = command.MangaUrl };
    }
}

internal sealed class GetMangaDexDetailQueryHandler([FromKeyedServices("mangadex")] IProviderScrapperService scrapperService)
    : IQueryHandler<GetMangaDexDetailQuery, ScrapperMangaDocumentResponse>
{
    public async Task<Result<ScrapperMangaDocumentResponse>> Handle(GetMangaDexDetailQuery query, CancellationToken ct)
    {
        var manga = await scrapperService.GetDetail(query.MangaUrl, ct);
        return manga;
    }
}

internal sealed class SearchMangaDexQueryHandler([FromKeyedServices("mangadex")] IProviderScrapperService scrapperService)
    : IQueryHandler<SearchMangaDexQuery, List<SearchItemResponse>>
{
    public async Task<Result<List<SearchItemResponse>>> Handle(SearchMangaDexQuery query, CancellationToken ct)
    {
        var results = await scrapperService.SearchManga(query.Request, ct);
        return results;
    }
}

public sealed class MangaDexEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper")
            .WithTags("ProviderScrapers")
            .RequireRateLimiting(RateLimitPolicies.Scraping);

        group.MapPost("/mangadex", async (ProviderScrapMangaRequest req, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new ScrapMangaDexMangaCommand(req.MangaUrl, req.ScrapChapterPages, req.LinkId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });

        group.MapGet("/mangadex/detail", async (string mangaUrl, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetMangaDexDetailQuery(mangaUrl), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });

        group.MapGet("/mangadex/search", async ([AsParameters] ScrapperSearchRequest req, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SearchMangaDexQuery(req), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });
    }
}
