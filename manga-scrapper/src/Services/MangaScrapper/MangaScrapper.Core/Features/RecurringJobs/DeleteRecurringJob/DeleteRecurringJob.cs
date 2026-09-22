using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.RecurringJobs.DeleteRecurringJob;

public record DeleteRecurringJobCommand(string JobId) : ICommand;

internal sealed class DeleteRecurringJobCommandHandler(IRecurringJobsService recurringJobsService) : ICommandHandler<DeleteRecurringJobCommand>
{
    public async Task<Result> Handle(DeleteRecurringJobCommand command, CancellationToken ct)
    {
        await recurringJobsService.DeleteRecurringJobAsync(command.JobId, ct);
        return Result.Success();
    }
}

public sealed class DeleteRecurringJobEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/recurring-jobs").WithTags("RecurringJobs");

        group.MapDelete("/{jobId}", async (string jobId, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new DeleteRecurringJobCommand(jobId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok<object?>(null, "Recurring job deleted")) : res.Error.ToHttpResult();
        }).WithName("DeleteRecurringJob");
    }
}
