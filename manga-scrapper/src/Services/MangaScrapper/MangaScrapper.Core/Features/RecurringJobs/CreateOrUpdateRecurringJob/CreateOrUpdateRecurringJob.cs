using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.RecurringJobs.CreateOrUpdateRecurringJob;

public record CreateOrUpdateRecurringJobCommand(string JobId, string CronExpression, string Provider, int ScrapLastTotalPage) : ICommand;

internal sealed class CreateOrUpdateRecurringJobCommandHandler(IRecurringJobsService recurringJobsService) : ICommandHandler<CreateOrUpdateRecurringJobCommand>
{
    public async Task<Result> Handle(CreateOrUpdateRecurringJobCommand command, CancellationToken ct)
    {
        await recurringJobsService.CreateOrUpdateLatestChapterScrapingJobAsync(command.JobId, command.CronExpression, command.Provider, command.ScrapLastTotalPage, ct);
        return Result.Success();
    }
}

public sealed class CreateOrUpdateRecurringJobEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/recurring-jobs").WithTags("RecurringJobs");

        group.MapPost("/", async (CreateOrUpdateRecurringJobCommand cmd, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(cmd, ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok<object?>(null, "Recurring job updated")) : res.Error.ToHttpResult();
        }).WithName("CreateOrUpdateRecurringJob");
    }
}
