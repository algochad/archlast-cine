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

namespace MangaScrapper.Core.Features.Mangas.GetSimilarMangaFiltered;

public record GetSimilarMangaFilteredQuery(
    Guid MangaId,
    string? Status,
    string? Type,
    List<string>? Genres,
    int Limit = 10) : IQuery<List<MangaSummaryResponse>>;

internal sealed class GetSimilarMangaFilteredQueryHandler(
    IMangaExternalRepository externalRepository,
    IMangaRepository mangaRepository)
    : IQueryHandler<GetSimilarMangaFilteredQuery, List<MangaSummaryResponse>>
{
    public async Task<Result<List<MangaSummaryResponse>>> Handle(GetSimilarMangaFilteredQuery request, CancellationToken cancellationToken)
    {
        // Verify the source manga exists
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(request.MangaId), cancellationToken);
        if (manga is null)
            return Result.Failure<List<MangaSummaryResponse>>(
                Error.NotFound("Manga.NotFound", $"Manga with ID '{request.MangaId}' was not found."));

        var similar = await externalRepository.GetSimilarFilteredAsync(
            request.MangaId,
            request.Status,
            request.Type,
            request.Genres,
            request.Limit,
            cancellationToken);

        return similar.Select(x => x.Adapt<MangaSummaryResponse>()).ToList();
    }
}

// endpoint
public sealed class GetSimilarMangaFilteredEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/{mangaId:guid}/similar/filtered", HandleAsync)
            .WithName("GetSimilarMangaFiltered")
            .WithSummary("Get mangas similar to a given manga filtered by status, type, or genres")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.VectorSearch)
            .Produces<ApiResponse<List<MangaSummaryResponse>>>();
    }

    private static async Task<IResult> HandleAsync(
        ISender sender,
        Guid mangaId,
        CancellationToken ct,
        string? status = null,
        string? type = null,
        string[]? genres = null,
        int limit = 10)
    {
        var result = await sender.Send(
            new GetSimilarMangaFilteredQuery(mangaId, status, type, genres?.ToList(), limit), ct);
        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value))
            : result.Error.ToHttpResult();
    }
}
