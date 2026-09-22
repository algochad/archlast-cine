using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.ProviderScrapers.Manhwadesu;

public record ScrapManhwadesuMangaCommand(string MangaUrl, bool ScrapChapterPages = true, string? LinkId = null) : ICommand<ScrapperMangaDocumentResponse>;
public record GetManhwadesuDetailQuery(string MangaUrl) : IQuery<ScrapperMangaDocumentResponse>;
public record SearchManhwadesuQuery(ScrapperSearchRequest Request) : IQuery<List<SearchItemResponse>>;

internal sealed class ScrapManhwadesuMangaCommandHandler(IMangaMessagePublisher messagePublisher)
    : ICommandHandler<ScrapManhwadesuMangaCommand, ScrapperMangaDocumentResponse>
{
    public async Task<Result<ScrapperMangaDocumentResponse>> Handle(ScrapManhwadesuMangaCommand command, CancellationToken ct)
    {
        await messagePublisher.PublishScrapMangaAsync("manhwadesu", command.MangaUrl, command.ScrapChapterPages, command.LinkId, ct);
        return new ScrapperMangaDocumentResponse { Url = command.MangaUrl };
    }
}

internal sealed class GetManhwadesuDetailQueryHandler([FromKeyedServices("manhwadesu")] IProviderScrapperService scrapperService)
    : IQueryHandler<GetManhwadesuDetailQuery, ScrapperMangaDocumentResponse>
{
    public async Task<Result<ScrapperMangaDocumentResponse>> Handle(GetManhwadesuDetailQuery query, CancellationToken ct)
    {
        var manga = await scrapperService.GetDetail(query.MangaUrl, ct);
        return manga;
    }
}

internal sealed class SearchManhwadesuQueryHandler([FromKeyedServices("manhwadesu")] IProviderScrapperService scrapperService)
    : IQueryHandler<SearchManhwadesuQuery, List<SearchItemResponse>>
{
    public async Task<Result<List<SearchItemResponse>>> Handle(SearchManhwadesuQuery query, CancellationToken ct)
    {
        var results = await scrapperService.SearchManga(query.Request, ct);
        return results;
    }
}

public sealed class ManhwadesuEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper")
            .WithTags("ProviderScrapers")
            .RequireRateLimiting(RateLimitPolicies.Scraping);

        group.MapPost("/manhwadesu", async (ProviderScrapMangaRequest req, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new ScrapManhwadesuMangaCommand(req.MangaUrl, req.ScrapChapterPages, req.LinkId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });

        group.MapGet("/manhwadesu/detail", async (string mangaUrl, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetManhwadesuDetailQuery(mangaUrl), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });

        group.MapGet("/manhwadesu/search", async ([AsParameters] ScrapperSearchRequest req, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SearchManhwadesuQuery(req), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        });
    }
}
