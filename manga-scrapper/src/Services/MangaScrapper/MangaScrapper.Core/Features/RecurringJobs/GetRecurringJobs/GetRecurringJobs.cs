using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.RecurringJobs.GetRecurringJobs;

public record RecurringJobDto(string Id, string Cron, string Queue, DateTime? NextExecution, DateTime? LastExecution, string LastJobState, DateTime? CreatedAt);

public record GetRecurringJobsQuery : IQuery<List<RecurringJobDto>>;

internal sealed class RecurringJobsQueryHandler(IRecurringJobsService recurringJobsService) : IQueryHandler<GetRecurringJobsQuery, List<RecurringJobDto>>
{
    public async Task<Result<List<RecurringJobDto>>> Handle(GetRecurringJobsQuery query, CancellationToken ct)
    {
        var jobs = await recurringJobsService.GetRecurringJobsAsync(ct);
        return Result.Success(jobs);
    }
}

public sealed class GetRecurringJobsEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/recurring-jobs").WithTags("RecurringJobs");

        group.MapGet("/", async (ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetRecurringJobsQuery(), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetRecurringJobs");
    }
}
