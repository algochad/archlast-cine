using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.RecurringJobs.TriggerRecurringJob;

public record TriggerRecurringJobCommand(string JobId) : ICommand;

internal sealed class TriggerRecurringJobCommandHandler(IRecurringJobsService recurringJobsService) : ICommandHandler<TriggerRecurringJobCommand>
{
    public async Task<Result> Handle(TriggerRecurringJobCommand command, CancellationToken ct)
    {
        await recurringJobsService.TriggerRecurringJobAsync(command.JobId, ct);
        return Result.Success();
    }
}

public sealed class TriggerRecurringJobEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/recurring-jobs").WithTags("RecurringJobs");

        group.MapPost("/{jobId}/trigger", async (string jobId, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new TriggerRecurringJobCommand(jobId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok<object?>(null, "Recurring job triggered")) : res.Error.ToHttpResult();
        }).WithName("TriggerRecurringJob");
    }
}
