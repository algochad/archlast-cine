using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.UserProgression.GetUserProgression;

public record GetUserProgressionQuery(string UserId) : IQuery<List<UserProgressionResponse>>;

internal sealed class GetUserProgressionQueryHandler(
    IUserProgressionRepository progressionRepository,
    IMangaRepository mangaRepository)
    : IQueryHandler<GetUserProgressionQuery, List<UserProgressionResponse>>
{
    public async Task<Result<List<UserProgressionResponse>>> Handle(GetUserProgressionQuery query, CancellationToken ct)
    {
        var items = await progressionRepository.GetByUserIdAsync(query.UserId, ct);
        var mangaIds = items.Select(x => x.MangaId.Value).Distinct().ToList();
        var mangas = await mangaRepository.GetByIdsAsync(mangaIds, ct);

        var mapped = items.Select(p =>
        {
            var manga = mangas.FirstOrDefault(m => m.Id.Equals(p.MangaId))?.Adapt<MangaSummaryResponse>();
            return new UserProgressionResponse(
                p.Id,
                p.UserId,
                p.MangaId.Value,
                p.LastReadAt,
                p.TotalReadingTime,
                p.ChapterLogs.Select(cl => new ChapterLogsResponse(
                    cl.Id,
                    cl.ChapterId,
                    cl.ChapterNumber,
                    cl.LastReadPage,
                    cl.TotalPages,
                    cl.IsCompleted,
                    cl.ReadingTimeSeconds,
                    cl.LastReadAt)).ToList(),
                manga
            );
        }).ToList();

        return mapped;
    }
}

public sealed class GetUserProgressionEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/user-progression").WithTags("UserProgression");

        group.MapGet("/{userId}", async (string userId, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetUserProgressionQuery(userId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetUserProgression")
        .Produces<ApiResponse<List<UserProgressionResponse>>>();
    }
}
