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

namespace MangaScrapper.Core.Features.Mangas.GetMangaById;

public record GetMangaByIdQuery(Guid Id) : IQuery<MangaSummaryResponse>;

internal sealed class GetMangaByIdQueryHandler(IMangaRepository mangaRepository)
    : IQueryHandler<GetMangaByIdQuery, MangaSummaryResponse>
{
    public async Task<Result<MangaSummaryResponse>> Handle(GetMangaByIdQuery query, CancellationToken ct)
    {
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(query.Id), ct);
        if (manga is null)
            return Error.NotFound("Manga.NotFound", $"Manga with Id '{query.Id}' was not found.");

        return manga.Adapt<MangaSummaryResponse>();
    }
}

public sealed class GetMangaByIdEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/{id:guid}", HandleAsync)
            .WithName("GetMangaById")
            .WithSummary("Get manga details by ID")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.Default)
            .Produces<ApiResponse<MangaSummaryResponse>>();
    }

    private static async Task<IResult> HandleAsync(Guid id, ISender sender, CancellationToken ct)
    {
        var result = await sender.Send(new GetMangaByIdQuery(id), ct);
        return result.IsSuccess ? Results.Ok(ApiResponse.Ok(result.Value)) : result.Error.ToHttpResult();
    }
}
