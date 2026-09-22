using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Dashboard.SyncAnilist;

public record SyncAnilistCommand : ICommand<Unit>;

internal sealed class SyncAnilistCommandHandler(IEventBus eventBus) : ICommandHandler<SyncAnilistCommand, Unit>
{
    public async Task<Result<Unit>> Handle(SyncAnilistCommand command, CancellationToken ct)
    {
        await eventBus.PublishAsync(new SyncAnilistIntegrationEvent(), "sync-anilist", ct);
        return Result.Success(Unit.Value);
    }
}

public sealed class SyncAnilistEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/dashboard").WithTags("Dashboard");

        group.MapPost("/sync-anilist", async (ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new SyncAnilistCommand(), ct);
            return res.IsSuccess ? Results.Accepted() : res.Error.ToHttpResult();
        }).RequireAuthorization(User.UserRoles.SuperUser).WithName("SyncAnilist");
    }
}
