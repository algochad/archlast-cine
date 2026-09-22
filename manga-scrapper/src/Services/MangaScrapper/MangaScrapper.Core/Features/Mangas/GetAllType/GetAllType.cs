using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.GetAllType;

public record GetAllTypeQuery : IQuery<List<string>>;

internal sealed class GetAllTypeQueryHandler(IMangaRepository mangaRepository) : IQueryHandler<GetAllTypeQuery, List<string>>
{
    public async Task<Result<List<string>>> Handle(GetAllTypeQuery query, CancellationToken ct)
    {
        return await mangaRepository.GetAllTypesAsync(ct);
    }
}

public sealed class GetAllTypeEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/types", HandleAsync)
            .WithName("GetAllType")
            .WithSummary("Get list of available manga types")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.Default)
            .Produces<ApiResponse<List<string>>>();
    }

    private static async Task<IResult> HandleAsync(ISender sender, CancellationToken ct)
    {
        var result = await sender.Send(new GetAllTypeQuery(), ct);
        return result.IsSuccess ? Results.Ok(ApiResponse.Ok(result.Value)) : result.Error.ToHttpResult();
    }
}
