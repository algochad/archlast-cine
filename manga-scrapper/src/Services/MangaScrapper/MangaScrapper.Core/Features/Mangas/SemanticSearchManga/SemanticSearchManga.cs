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

namespace MangaScrapper.Core.Features.Mangas.SemanticSearchManga;

public record SemanticSearchMangaQuery(string QueryText, int Limit = 10) : IQuery<List<MangaSummaryResponse>>;

internal sealed class SemanticSearchMangaValidator : AbstractValidator<SemanticSearchMangaQuery>
{
    public SemanticSearchMangaValidator()
    {
        RuleFor(x => x.QueryText)
            .NotEmpty().WithMessage("Search query cannot be empty.")
            .MaximumLength(500).WithMessage("Search query must not exceed 500 characters.");

        RuleFor(x => x.Limit)
            .InclusiveBetween(1, 50).WithMessage("Limit must be between 1 and 50.");
    }
}

internal sealed class SemanticSearchMangaQueryHandler(IMangaExternalRepository repository)
    : IQueryHandler<SemanticSearchMangaQuery, List<MangaSummaryResponse>>
{
    public async Task<Result<List<MangaSummaryResponse>>> Handle(SemanticSearchMangaQuery request, CancellationToken cancellationToken)
    {
        var mangas = await repository.SemanticSearchAsync(request.QueryText, request.Limit, cancellationToken);
        return mangas.Select(x => x.Adapt<MangaSummaryResponse>()).ToList();
    }
}

// endpoint
public sealed class SemanticSearchMangaEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/search/semantic", HandleAsync)
            .WithName("SemanticSearchManga")
            .WithSummary("Multilingual semantic search using vector embeddings (100+ languages including Indonesian)")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.SemanticSearch)
            .Produces<ApiResponse<List<MangaSummaryResponse>>>();
    }

    private static async Task<IResult> HandleAsync(
        ISender sender,
        CancellationToken ct,
        string q,
        int limit = 10)
    {
        var result = await sender.Send(new SemanticSearchMangaQuery(q, limit), ct);
        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value))
            : result.Error.ToHttpResult();
    }
}
