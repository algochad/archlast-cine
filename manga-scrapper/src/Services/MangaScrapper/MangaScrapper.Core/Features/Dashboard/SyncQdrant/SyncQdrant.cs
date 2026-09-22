using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Dashboard.SyncQdrant;

public record SyncQdrantCommand : ICommand<Unit>;

internal sealed class SyncQdrantCommandHandler(IEventBus eventBus) : ICommandHandler<SyncQdrantCommand, Unit>
{
    public async Task<Result<Unit>> Handle(SyncQdrantCommand command, CancellationToken ct)
    {
        await eventBus.PublishAsync(new SyncQdrantIntegrationEvent(), "sync-qdrant", ct);
        return Result.Success(Unit.Value);
    }
}

public sealed class SyncQdrantEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/dashboard").WithTags("Dashboard");

        group.MapPost("/sync-qdrant", async (ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SyncQdrantCommand(), ct);
            return res.IsSuccess ? Results.Accepted() : res.Error.ToHttpResult();
        }).RequireAuthorization(User.UserRoles.SuperUser).WithName("SyncQdrant");
    }
}
