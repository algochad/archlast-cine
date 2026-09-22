using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Dashboard.SyncMeilisearch;

public record SyncMeilisearchCommand : ICommand<Unit>;

internal sealed class SyncMeilisearchCommandHandler(IEventBus eventBus) : ICommandHandler<SyncMeilisearchCommand, Unit>
{
    public async Task<Result<Unit>> Handle(SyncMeilisearchCommand command, CancellationToken ct)
    {
        await eventBus.PublishAsync(new SyncMeilisearchIntegrationEvent(), "sync-meilisearch", ct);
        return Result.Success(Unit.Value);
    }
}

public sealed class SyncMeilisearchEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/dashboard").WithTags("Dashboard");

        group.MapPost("/sync-meilisearch", async (ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SyncMeilisearchCommand(), ct);
            return res.IsSuccess ? Results.Accepted() : res.Error.ToHttpResult();
        }).RequireAuthorization(User.UserRoles.SuperUser).WithName("SyncMeilisearch");
    }
}
