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

namespace MangaScrapper.Core.Features.Mangas.GetRecomendation;

public record GetRecomendationQuery(List<Guid> ReadingHistoryIds, int Limit = 10) : IQuery<List<MangaSummaryResponse>>;

internal sealed class GetRecomendationQueryHandler(IMangaExternalRepository repository)
    : IQueryHandler<GetRecomendationQuery, List<MangaSummaryResponse>>
{
    public async Task<Result<List<MangaSummaryResponse>>> Handle(GetRecomendationQuery request, CancellationToken cancellationToken)
    {
        if (!request.ReadingHistoryIds.Any())
        {
            return new List<MangaSummaryResponse>();
        }
        
        var data = await repository.GetRecomendationAsync(request.ReadingHistoryIds, request.Limit, cancellationToken);
        return data.Select(x=>x.Adapt<MangaSummaryResponse>()).ToList();
    }
}


//endpoint
public sealed class GetRecomendationQueryEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/manga/recomendations", HandleAsync)
            .WithName("GetRecomendation")
            .WithSummary("Get manga recomendations by")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.VectorSearch)
            .Produces<ApiResponse<List<MangaSummaryResponse>>>();
    }

    private static async Task<IResult> HandleAsync(ISender sender, CancellationToken ct,Guid[] readingHistoryIds,int limit =10)
    {
        var result = await sender.Send(new GetRecomendationQuery(readingHistoryIds.ToList(),limit), ct);
        return result.IsSuccess ? Results.Ok(ApiResponse.Ok(result.Value)) : result.Error.ToHttpResult();
    }
}
