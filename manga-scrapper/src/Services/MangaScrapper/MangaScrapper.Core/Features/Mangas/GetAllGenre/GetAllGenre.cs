using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.GetAllGenre;

public record GetAllGenreQuery : IQuery<List<string>>;

internal sealed class GetAllGenreQueryHandler(IMangaRepository mangaRepository) : IQueryHandler<GetAllGenreQuery, List<string>>
{
    public async Task<Result<List<string>>> Handle(GetAllGenreQuery query, CancellationToken ct)
    {
        return await mangaRepository.GetAllGenresAsync(ct);
    }
}

public sealed class GetAllGenreEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/genres", HandleAsync)
            .WithName("GetAllGenre")
            .WithSummary("Get list of available genres")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.Default)
            .Produces<ApiResponse<List<string>>>();
    }

    private static async Task<IResult> HandleAsync(ISender sender, CancellationToken ct)
    {
        var result = await sender.Send(new GetAllGenreQuery(), ct);
        return result.IsSuccess ? Results.Ok(ApiResponse.Ok(result.Value)) : result.Error.ToHttpResult();
    }
}
