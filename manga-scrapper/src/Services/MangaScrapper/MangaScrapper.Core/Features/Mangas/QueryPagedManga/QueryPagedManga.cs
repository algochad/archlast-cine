using FluentValidation;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Requests;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.QueryPagedManga;

public record QueryPagedMangaQuery(
    MangaAdvancedFilter? Filter = null,
    List<MangaSortOption>? Sorts = null,
    int Page = 1,
    int PageSize = 10) : IQuery<PagedResponse<MangaSummaryResponse>>;

public sealed class QueryPagedMangaValidator : AbstractValidator<QueryPagedMangaQuery>
{
    private static readonly HashSet<string> ValidSortFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "title", "rating", "popularity", "members", "totalView", "views", "view",
        "releaseDate", "release_date", "year", "totalChapters", "chapters",
        "latestChapterNumber", "latestchapter", "chapter",
        "createdAt", "created_at", "createdattimestamp",
        "updatedAt", "updated_at", "updatedattimestamp"
    };

    public QueryPagedMangaValidator()
    {
        RuleFor(x => x.Page)
            .GreaterThanOrEqualTo(1).WithMessage("Page must be at least 1.");

        RuleFor(x => x.PageSize)
            .InclusiveBetween(1, 100).WithMessage("PageSize must be between 1 and 100.");

        When(x => x.Filter != null, () =>
        {
            RuleFor(x => x.Filter!.MinRating)
                .InclusiveBetween(0, 10).When(x => x.Filter!.MinRating.HasValue)
                .WithMessage("MinRating must be between 0 and 10.");

            RuleFor(x => x.Filter!.MaxRating)
                .InclusiveBetween(0, 10).When(x => x.Filter!.MaxRating.HasValue)
                .WithMessage("MaxRating must be between 0 and 10.");

            RuleFor(x => x.Filter!)
                .Must(f => !f.MinRating.HasValue || !f.MaxRating.HasValue || f.MinRating.Value <= f.MaxRating.Value)
                .WithMessage("MinRating cannot be greater than MaxRating.");

            RuleFor(x => x.Filter!)
                .Must(f => !f.MinPopularity.HasValue || !f.MaxPopularity.HasValue || f.MinPopularity.Value <= f.MaxPopularity.Value)
                .WithMessage("MinPopularity cannot be greater than MaxPopularity.");

            RuleFor(x => x.Filter!)
                .Must(f => !f.MinTotalView.HasValue || !f.MaxTotalView.HasValue || f.MinTotalView.Value <= f.MaxTotalView.Value)
                .WithMessage("MinTotalView cannot be greater than MaxTotalView.");

            RuleFor(x => x.Filter!)
                .Must(f => !f.MinChapters.HasValue || !f.MaxChapters.HasValue || f.MinChapters.Value <= f.MaxChapters.Value)
                .WithMessage("MinChapters cannot be greater than MaxChapters.");

            RuleFor(x => x.Filter!)
                .Must(f => !f.StartReleaseDate.HasValue || !f.EndReleaseDate.HasValue || f.StartReleaseDate.Value <= f.EndReleaseDate.Value)
                .WithMessage("StartReleaseDate cannot be after EndReleaseDate.");

            RuleFor(x => x.Filter!.AnilistId)
                .GreaterThanOrEqualTo(0).When(x => x.Filter!.AnilistId.HasValue)
                .WithMessage("AnilistId must be greater than or equal to 0.");
        });

        RuleForEach(x => x.Sorts)
            .ChildRules(sort =>
            {
                sort.RuleFor(s => s.Field)
                    .NotEmpty().WithMessage("Sort field cannot be empty.")
                    .Must(f => ValidSortFields.Contains(f))
                    .WithMessage(s => $"Sort field '{s.Field}' is invalid.");

                sort.RuleFor(s => s.Direction)
                    .Must(d => string.Equals(d, "asc", StringComparison.OrdinalIgnoreCase) || string.Equals(d, "desc", StringComparison.OrdinalIgnoreCase))
                    .WithMessage("Sort direction must be 'asc' or 'desc'.");
            })
            .When(x => x.Sorts != null);
    }
}

public sealed class QueryPagedMangaQueryHandler(
    IMangaExternalRepository mangaExternalRepository)
    : IQueryHandler<QueryPagedMangaQuery, PagedResponse<MangaSummaryResponse>>
{
    public async Task<Result<PagedResponse<MangaSummaryResponse>>> Handle(
        QueryPagedMangaQuery query,
        CancellationToken ct)
    {
        var data = await mangaExternalRepository.QueryAdvancedAsync(
            query.Filter,
            query.Sorts,
            query.Page,
            query.PageSize,
            ct);

        return PagedResponse<MangaSummaryResponse>.Create(
            data.Items.Select(x => x.Adapt<MangaSummaryResponse>()),
            data.Page,
            data.PageSize,
            data.TotalCount);
    }
}

public sealed class QueryPagedMangaEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapMethods("/api/v1/manga", new[]{HttpMethods.Query}, HandleAsync)
            .WithName("QueryPagedManga")
            .WithSummary("Query paged list of manga using advanced filters and sorting")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.Default)
            .Produces<ApiResponse<PagedResponse<MangaSummaryResponse>>>();
    }

    private static async Task<IResult> HandleAsync(
        ISender sender,
        [FromBody] QueryPagedMangaRequest request,
        CancellationToken ct)
    {
        var query = new QueryPagedMangaQuery(
            request.Filter,
            request.Sorts,
            request.Page,
            request.PageSize);

        var result = await sender.Send(query, ct);

        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value))
            : result.Error.ToHttpResult();
    }
}
