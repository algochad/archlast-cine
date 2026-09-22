using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Scrapper.GetQueue;

public record GetQueueQuery : IQuery<List<JobQueueItemResponse>>;

internal sealed class GetQueueQueryHandler(IScrapperQueueService queueService)
    : IQueryHandler<GetQueueQuery, List<JobQueueItemResponse>>
{
    public async Task<Result<List<JobQueueItemResponse>>> Handle(GetQueueQuery query, CancellationToken ct)
    {
        var rawJobs = await queueService.GetQueuedJobsAsync();

        var items = rawJobs.Select(j => new JobQueueItemResponse
        {
            Id = j.Id,
            JobName = j.JobName,
            State = j.State,
            CreatedAt = DateTime.UtcNow
        }).ToList();

        return items;
    }
}

public sealed class GetQueueEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper").WithTags("Scrapper");

        group.MapGet("/queue", async (ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetQueueQuery(), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetScrapperQueue");
    }
}
