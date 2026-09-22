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

namespace MangaScrapper.Core.Features.Mangas.GetSimilarManga;

public record GetSimilarMangaQuery(Guid MangaId, int Limit = 10) : IQuery<List<MangaSummaryResponse>>;

internal sealed class GetSimilarMangaQueryHandler(
    IMangaExternalRepository externalRepository,
    IMangaRepository mangaRepository)
    : IQueryHandler<GetSimilarMangaQuery, List<MangaSummaryResponse>>
{
    public async Task<Result<List<MangaSummaryResponse>>> Handle(GetSimilarMangaQuery request, CancellationToken cancellationToken)
    {
        // Ensure the source manga exists before querying Qdrant
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(request.MangaId), cancellationToken);
        if (manga is null)
            return Result.Failure<List<MangaSummaryResponse>>(
                Error.NotFound("Manga.NotFound", $"Manga with ID '{request.MangaId}' was not found."));

        var similar = await externalRepository.GetSimilarAsync(request.MangaId, request.Limit, cancellationToken);
        return similar.Select(x => x.Adapt<MangaSummaryResponse>()).ToList();
    }
}

// endpoint
public sealed class GetSimilarMangaEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/{mangaId:guid}/similar", HandleAsync)
            .WithName("GetSimilarManga")
            .WithSummary("Get mangas semantically similar to a given manga using vector search")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.VectorSearch)
            .Produces<ApiResponse<List<MangaSummaryResponse>>>();
    }

    private static async Task<IResult> HandleAsync(
        ISender sender,
        Guid mangaId,
        CancellationToken ct,
        int limit = 10)
    {
        var result = await sender.Send(new GetSimilarMangaQuery(mangaId, limit), ct);
        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value))
            : result.Error.ToHttpResult();
    }
}
