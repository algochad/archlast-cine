using FluentValidation;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.GetAdvancedRecommendation;

public record GetAdvancedRecommendationQuery(
    List<Guid> LikedIds,
    List<Guid> DislikedIds,
    int Limit = 10) : IQuery<List<MangaSummaryResponse>>;

internal sealed class GetAdvancedRecommendationValidator : AbstractValidator<GetAdvancedRecommendationQuery>
{
    public GetAdvancedRecommendationValidator()
    {
        RuleFor(x => x.LikedIds)
            .NotEmpty().WithMessage("At least one liked manga ID is required.")
            .Must(ids => ids.Count <= 20).WithMessage("Cannot provide more than 20 liked IDs.");

        RuleFor(x => x.DislikedIds)
            .Must(ids => ids == null || ids.Count <= 20).WithMessage("Cannot provide more than 20 disliked IDs.");

        RuleFor(x => x.Limit)
            .InclusiveBetween(1, 50).WithMessage("Limit must be between 1 and 50.");
    }
}

internal sealed class GetAdvancedRecommendationQueryHandler(IMangaExternalRepository repository)
    : IQueryHandler<GetAdvancedRecommendationQuery, List<MangaSummaryResponse>>
{
    public async Task<Result<List<MangaSummaryResponse>>> Handle(GetAdvancedRecommendationQuery request, CancellationToken cancellationToken)
    {
        var mangas = await repository.GetAdvancedRecommendationAsync(
            request.LikedIds,
            request.DislikedIds ?? new List<Guid>(),
            request.Limit,
            cancellationToken);

        return mangas.Select(x => x.Adapt<MangaSummaryResponse>()).ToList();
    }
}

// endpoint
public sealed class GetAdvancedRecommendationEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/manga/recommend/advanced", HandleAsync)
            .WithName("GetAdvancedRecommendation")
            .WithSummary("Recommend manga using positive (liked) and negative (disliked) examples via Qdrant native vector arithmetic")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.VectorSearch)
            .Produces<ApiResponse<List<MangaSummaryResponse>>>();
    }

    private static async Task<IResult> HandleAsync(
        ISender sender,
        AdvancedRecommendationRequest body,
        CancellationToken ct)
    {
        var result = await sender.Send(
            new GetAdvancedRecommendationQuery(body.LikedIds, body.DislikedIds, body.Limit), ct);
        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value))
            : result.Error.ToHttpResult();
    }
}

/// <summary>Request body for the advanced recommendation endpoint.</summary>
public sealed class AdvancedRecommendationRequest
{
    /// <summary>Manga IDs the user likes. At least one is required.</summary>
    public List<Guid> LikedIds { get; set; } = new();

    /// <summary>Manga IDs the user dislikes. Optional — leaving empty returns standard centroid recommendations.</summary>
    public List<Guid> DislikedIds { get; set; } = new();

    /// <summary>Maximum number of results to return (1–50).</summary>
    public int Limit { get; set; } = 10;
}
