using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.Infrastructure.Http;
using NovaStack.SharedKernel.Abstractions;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Users.PatchUserHearthbeat;

[NoLogging]
public record PatchUserHearthbeatCommand(string? ClientIpAddress = null) : ICommand<UserHeartbeatResponse>;

public sealed class PatchUserHearthbeatCommandHandler(IUserRepository userRepository, IClaimService claimService) : ICommandHandler<PatchUserHearthbeatCommand, UserHeartbeatResponse>
{
    public async Task<Result<UserHeartbeatResponse>> Handle(PatchUserHearthbeatCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = claimService.GetCurrentUserId();
        if (string.IsNullOrEmpty(currentUserId) || !Guid.TryParse(currentUserId, out var parsedGuid))
            return Error.Unauthorized("User.Unauthorized", "User is not authenticated.");

        var user = await userRepository.GetByIdAsync(UserId.From(parsedGuid), cancellationToken);
        if (user is null)
            return Error.NotFound("User.NotFound", $"User with Id '{currentUserId}' was not found.");

        user.LastActiveAt = DateTime.UtcNow;
        var ip = !string.IsNullOrWhiteSpace(request.ClientIpAddress)
            ? request.ClientIpAddress
            : claimService.GetClientIpAddress();

        if (!string.IsNullOrWhiteSpace(ip))
        {
            user.ClientIpAddress = ip;
        }

        await userRepository.UpdateAsync(user, cancellationToken);
        return new UserHeartbeatResponse(user.Id.Value, user.Username, user.LastActiveAt ?? DateTime.UtcNow, user.ClientIpAddress);
    }
}

public sealed class GetUserHearthbeatEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/users").WithTags("Users");

        group.MapPatch("/heartbeat", async (HttpContext httpContext, ISender sender, CancellationToken ct) =>
        {
            var clientIp = httpContext.GetClientIpAddress();
            var res = await sender.Send(new PatchUserHearthbeatCommand(clientIp), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        })
        .RequireAuthorization()
        .RequireRateLimiting(RateLimitPolicies.Default)
        .WithName("PatchUserHearthbeat")
        .WithDescription("Patch user heartbeat")
        .WithTags("Users")
        .Produces<ApiResponse<UserHeartbeatResponse>>();
    }
}
