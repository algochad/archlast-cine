using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Dashboard.SyncStorage;

public record SyncStorageCommand : ICommand<Unit>;

internal sealed class SyncStorageCommandHandler(IEventBus eventBus) : ICommandHandler<SyncStorageCommand, Unit>
{
    public async Task<Result<Unit>> Handle(SyncStorageCommand command, CancellationToken ct)
    {
        await eventBus.PublishAsync(new SyncStorageIntegrationEvent(), "sync-storage", ct);
        return Result.Success(Unit.Value);
    }
}

public sealed class SyncStorageEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/dashboard").WithTags("Dashboard");

        group.MapPost("/sync-storage", async (ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SyncStorageCommand(), ct);
            return res.IsSuccess ? Results.Accepted() : res.Error.ToHttpResult();
        }).RequireAuthorization(User.UserRoles.SuperUser).WithName("SyncStorage");
    }
}
