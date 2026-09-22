using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.GetAllChapters;

public record GetAllChaptersQuery(Guid MangaId) : IQuery<List<ChapterResponse>>;

internal sealed class GetAllChaptersQueryHandler(IMangaRepository mangaRepository)
    : IQueryHandler<GetAllChaptersQuery, List<ChapterResponse>>
{
    public async Task<Result<List<ChapterResponse>>> Handle(GetAllChaptersQuery query, CancellationToken ct)
    {
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(query.MangaId), ct);
        if (manga is null)
            return Error.NotFound("Manga.NotFound", $"Manga with Id '{query.MangaId}' was not found.");

        var chapters = manga.Chapters.OrderByDescending(c => c.Number).Select(c => c.Adapt<ChapterResponse>()).ToList();

        return chapters;
    }
}

public sealed class GetAllChaptersEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/{mangaId:guid}/chapters", HandleAsync)
            .WithName("GetAllChapters")
            .WithSummary("Get all chapters for a manga")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.Default)
            .Produces<ApiResponse<List<ChapterResponse>>>();
    }

    private static async Task<IResult> HandleAsync(Guid mangaId, ISender sender, CancellationToken ct)
    {
        var result = await sender.Send(new GetAllChaptersQuery(mangaId), ct);
        return result.IsSuccess ? Results.Ok(ApiResponse.Ok(result.Value)) : result.Error.ToHttpResult();
    }
}
