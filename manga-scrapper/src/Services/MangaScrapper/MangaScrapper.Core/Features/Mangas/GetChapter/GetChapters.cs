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

namespace MangaScrapper.Core.Features.Mangas.GetChapter;

public record GetChaptersQuery(Guid MangaId, Guid ChapterId) : IQuery<ChapterResponse>;

internal sealed class GetChaptersQueryHandler(IMangaRepository mangaRepository)
    : IQueryHandler<GetChaptersQuery, ChapterResponse>
{
    public async Task<Result<ChapterResponse>> Handle(GetChaptersQuery query, CancellationToken ct)
    {
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(query.MangaId), ct);
        if (manga is null)
            return Error.NotFound("Manga.NotFound", $"Manga with Id '{query.MangaId}' was not found.");

        var chapter = manga.Chapters.FirstOrDefault(x=>x.Id.Value==query.ChapterId);
        
        if (chapter is null)
            return Error.NotFound("Chapter.NotFound", $"Chapter with Id '{query.ChapterId}' was not found.");

        return chapter.Adapt<ChapterResponse>() with
        {
            Pages = chapter.Pages.Select(x => new ChapterPageResponse(
                x.LocalImageUrl,
                x.Width,
                x.Height,
                x.ImageUrl,
                x.IsFallback)).ToList()
        };
    }
}

public sealed class GetChaptersEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/{mangaId:guid}/chapters/{chapterId:guid}", HandleAsync)
            .WithName("GetChapters")
            .WithSummary("Get single chapters for a manga")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.Default)
            .Produces<ApiResponse<ChapterResponse>>();
    }

    private static async Task<IResult> HandleAsync(Guid mangaId,Guid chapterId, ISender sender, CancellationToken ct)
    {
        var result = await sender.Send(new GetChaptersQuery(mangaId,chapterId), ct);
        return result.IsSuccess ? Results.Ok(ApiResponse.Ok(result.Value)) : result.Error.ToHttpResult();
    }
}
