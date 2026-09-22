using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.ProviderScrapers.DoujinDesu;

public record ScrapDoujinDesuMangaCommand(string MangaUrl, bool ScrapChapterPages = true, string? LinkId = null) : ICommand<ScrapperMangaDocumentResponse>;
public record GetDoujinDesuDetailQuery(string MangaUrl) : IQuery<ScrapperMangaDocumentResponse>;
public record SearchDoujinDesuQuery(ScrapperSearchRequest Request) : IQuery<List<SearchItemResponse>>;

internal sealed class ScrapDoujinDesuMangaCommandHandler(IMangaMessagePublisher messagePublisher)
    : ICommandHandler<ScrapDoujinDesuMangaCommand, ScrapperMangaDocumentResponse>
{
    public async Task<Result<ScrapperMangaDocumentResponse>> Handle(ScrapDoujinDesuMangaCommand command, CancellationToken ct)
    {
        await messagePublisher.PublishScrapMangaAsync("doujindesu", command.MangaUrl, command.ScrapChapterPages, command.LinkId, ct);
        return new ScrapperMangaDocumentResponse { Url = command.MangaUrl };
    }
}

internal sealed class GetDoujinDesuDetailQueryHandler([FromKeyedServices("doujindesu")] IProviderScrapperService scrapperService)
    : IQueryHandler<GetDoujinDesuDetailQuery, ScrapperMangaDocumentResponse>
{
    public async Task<Result<ScrapperMangaDocumentResponse>> Handle(GetDoujinDesuDetailQuery query, CancellationToken ct)
    {
        var manga = await scrapperService.GetDetail(query.MangaUrl, ct);
        return manga;
    }
}

internal sealed class SearchDoujinDesuQueryHandler([FromKeyedServices("doujindesu")] IProviderScrapperService scrapperService)
    : IQueryHandler<SearchDoujinDesuQuery, List<SearchItemResponse>>
{
    public async Task<Result<List<SearchItemResponse>>> Handle(SearchDoujinDesuQuery query, CancellationToken ct)
    {
        var results = await scrapperService.SearchManga(query.Request, ct);
        return results;
    }
}

public sealed class DoujinDesuEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper")
            .WithTags("ProviderScrapers")
            .RequireRateLimiting(RateLimitPolicies.Scraping);

        group.MapPost("/doujindesu", async (ProviderScrapMangaRequest req, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new ScrapDoujinDesuMangaCommand(req.MangaUrl, req.ScrapChapterPages, req.LinkId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });

        group.MapGet("/doujindesu/detail", async (string mangaUrl, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetDoujinDesuDetailQuery(mangaUrl), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });

        group.MapGet("/doujindesu/search", async ([AsParameters] ScrapperSearchRequest req, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SearchDoujinDesuQuery(req), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });
    }
}
