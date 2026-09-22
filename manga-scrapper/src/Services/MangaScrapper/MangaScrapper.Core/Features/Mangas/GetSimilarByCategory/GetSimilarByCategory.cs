using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.GetSimilarByCategory;

public record GetSimilarByCategoryQuery(
    List<string>? Categories = null,
    Guid? MangaId = null,
    string? Status = null,
    string? Type = null,
    List<string>? Genres = null,
    Guid? ExcludeMangaId = null,
    int Limit = 10) : IQuery<List<MangaSummaryResponse>>;

public record SimilarByCategoryRequest(
    List<string>? Categories = null,
    string? Status = null,
    string? Type = null,
    List<string>? Genres = null,
    Guid? ExcludeMangaId = null,
    int Limit = 10);

public sealed class GetSimilarByCategoryQueryHandler(
    IMangaExternalRepository externalRepository,
    IMangaRepository mangaRepository)
    : IQueryHandler<GetSimilarByCategoryQuery, List<MangaSummaryResponse>>
{
    public async Task<Result<List<MangaSummaryResponse>>> Handle(GetSimilarByCategoryQuery request, CancellationToken cancellationToken)
    {
        var categories = request.Categories ?? new List<string>();
        var excludeMangaId = request.ExcludeMangaId;

        // If MangaId is provided, resolve categories from the existing manga
        if (request.MangaId.HasValue && request.MangaId.Value != Guid.Empty)
        {
            var manga = await mangaRepository.GetByIdAsync(MangaId.From(request.MangaId.Value), cancellationToken);
            if (manga is null)
            {
                return Result.Failure<List<MangaSummaryResponse>>(
                    Error.NotFound("Manga.NotFound", $"Manga with ID '{request.MangaId}' was not found."));
            }

            excludeMangaId ??= request.MangaId.Value;

            if (categories.Count == 0 && manga.Categories != null && manga.Categories.Count > 0)
            {
                categories = manga.Categories;
            }
        }

        // Clean and ensure at least one category exists
        var cleanedCategories = categories
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .SelectMany(c => c.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (cleanedCategories.Count == 0)
        {
            return Result.Failure<List<MangaSummaryResponse>>(
                Error.Validation("Category.Required", "At least one valid category must be provided or present on the source manga."));
        }

        var similar = await externalRepository.GetSimilarByCategoryAsync(
            cleanedCategories,
            request.Status,
            request.Type,
            request.Genres,
            excludeMangaId,
            request.Limit,
            cancellationToken);

        return similar.Select(x => x.Adapt<MangaSummaryResponse>()).ToList();
    }
}

// endpoint
public sealed class GetSimilarByCategoryEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        // 1. GET by query params
        app.MapGet("/api/v1/manga/similar/by-category", HandleGetAsync)
            .WithName("GetSimilarMangaByCategory")
            .WithSummary("Get mangas similar by category / tropes with optional status, type, and genres filtering")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.VectorSearch)
            .Produces<ApiResponse<List<MangaSummaryResponse>>>();

        // 2. POST with JSON body for large category collections
        app.MapPost("/api/v1/manga/similar/by-category", HandlePostAsync)
            .WithName("PostSimilarMangaByCategory")
            .WithSummary("Get mangas similar by category / tropes with optional status, type, and genres filtering via body")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.VectorSearch)
            .Produces<ApiResponse<List<MangaSummaryResponse>>>();

        // 3. GET similar by an existing manga's categories
        app.MapGet("/api/v1/manga/{mangaId:guid}/similar/by-category", HandleByMangaIdAsync)
            .WithName("GetSimilarMangaByIdCategories")
            .WithSummary("Get mangas similar to a given manga's categories / tropes with optional status, type, and genres filtering")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.VectorSearch)
            .Produces<ApiResponse<List<MangaSummaryResponse>>>();
    }

    private static async Task<IResult> HandleGetAsync(
        ISender sender,
        CancellationToken ct,
        string[]? categories = null,
        string? status = null,
        string? type = null,
        string[]? genres = null,
        Guid? excludeMangaId = null,
        int limit = 10)
    {
        var categoryList = categories?
            .SelectMany(c => c.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .ToList();

        var genreList = genres?
            .SelectMany(g => g.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(g => !string.IsNullOrWhiteSpace(g))
            .ToList();

        var result = await sender.Send(
            new GetSimilarByCategoryQuery(categoryList, null, status, type, genreList, excludeMangaId, limit), ct);

        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value))
            : result.Error.ToHttpResult();
    }

    private static async Task<IResult> HandlePostAsync(
        ISender sender,
        [FromBody] SimilarByCategoryRequest request,
        CancellationToken ct)
    {
        var categoryList = request.Categories?
            .SelectMany(c => c.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .ToList();

        var genreList = request.Genres?
            .SelectMany(g => g.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(g => !string.IsNullOrWhiteSpace(g))
            .ToList();

        var result = await sender.Send(
            new GetSimilarByCategoryQuery(categoryList, null, request.Status, request.Type, genreList, request.ExcludeMangaId, request.Limit), ct);

        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value))
            : result.Error.ToHttpResult();
    }

    private static async Task<IResult> HandleByMangaIdAsync(
        ISender sender,
        Guid mangaId,
        CancellationToken ct,
        string? status = null,
        string? type = null,
        string[]? genres = null,
        int limit = 10)
    {
        var genreList = genres?
            .SelectMany(g => g.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(g => !string.IsNullOrWhiteSpace(g))
            .ToList();

        var result = await sender.Send(
            new GetSimilarByCategoryQuery(null, mangaId, status, type, genreList, mangaId, limit), ct);

        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value))
            : result.Error.ToHttpResult();
    }
}
