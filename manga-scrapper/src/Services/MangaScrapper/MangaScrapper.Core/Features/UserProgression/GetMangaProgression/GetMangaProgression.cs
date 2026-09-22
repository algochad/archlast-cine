using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.UserProgression.GetMangaProgression;

public record GetMangaProgressionQuery(string UserId, Guid MangaId) : IQuery<UserProgressionResponse>;

internal sealed class GetMangaProgressionQueryHandler(IUserProgressionRepository progressionRepository,IMangaRepository mangaRepository)
    : IQueryHandler<GetMangaProgressionQuery, UserProgressionResponse>
{
    public async Task<Result<UserProgressionResponse>> Handle(GetMangaProgressionQuery query, CancellationToken ct)
    {
        var p = await progressionRepository.GetByUserIdAndMangaIdAsync(query.UserId, MangaId.From(query.MangaId), ct);
        if (p is null)
            return Error.NotFound("UserProgression.NotFound", "No progression recorded for this manga.");
        
        var mangas = await mangaRepository.GetByIdsAsync(new(){p.MangaId.Value}, ct);

        return new UserProgressionResponse(
            p.Id, 
            p.UserId, 
            p.MangaId.Value, 
            p.LastReadAt,
            p.TotalReadingTime,
            p.ChapterLogs.OrderByDescending(o=>o.LastReadAt).Select(cl => new ChapterLogsResponse(cl.Id, cl.ChapterId, cl.ChapterNumber, cl.LastReadPage, cl.TotalPages, cl.IsCompleted, cl.ReadingTimeSeconds, cl.LastReadAt)).ToList(),
            mangas.FirstOrDefault().Adapt<MangaSummaryResponse>()
        );
    }
}

public sealed class GetMangaProgressionEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/user-progression").WithTags("UserProgression");

        group.MapGet("/{userId}/{mangaId:guid}", async (string userId, Guid mangaId, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetMangaProgressionQuery(userId, mangaId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetMangaProgression")
        .Produces<ApiResponse<UserProgressionResponse>>();
    }
}
