using System.Security.Claims;
using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Auth.UserInfo;

public record UserInfoQuery(ClaimsPrincipal Principal) : IQuery<UserInfoResponse>;

internal sealed class UserInfoQueryHandler : IQueryHandler<UserInfoQuery, UserInfoResponse>
{
    public Task<Result<UserInfoResponse>> Handle(UserInfoQuery query, CancellationToken ct)
    {
        var principal = query.Principal;

        if (principal.Identity?.IsAuthenticated != true)
        {
            return Task.FromResult<Result<UserInfoResponse>>(
                new UserInfoResponse(false, string.Empty, string.Empty, string.Empty, [], string.Empty));
        }

        var userId = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? string.Empty;
        // "Username" custom claim set at login; fall back to Identity.Name (email)
        var username = principal.FindFirst("Username")?.Value
                       ?? principal.Identity.Name
                       ?? string.Empty;
        var email = principal.FindFirst(ClaimTypes.Name)?.Value
                    ?? principal.FindFirst(ClaimTypes.Email)?.Value
                    ?? string.Empty;
        var roles = principal.FindAll(ClaimTypes.Role).Select(c => c.Value).ToList();
        var firebaseUid = principal.FindFirst("FirebaseUid")?.Value ?? string.Empty;

        var response = new UserInfoResponse(true, userId, username, email, roles, firebaseUid);
        return Task.FromResult<Result<UserInfoResponse>>(response);
    }
}

public sealed class UserInfoEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/auth/me", HandleAsync)
            .WithName("UserInfo")
            .WithSummary("Get authenticated user info")
            .WithTags("Auth")
            .Produces<ApiResponse<UserInfoResponse>>();
    }

    private static async Task<IResult> HandleAsync(HttpContext context, ISender sender, CancellationToken ct)
    {
        var result = await sender.Send(new UserInfoQuery(context.User), ct);
        return result.IsSuccess ? Results.Ok(ApiResponse.Ok(result.Value)) : result.Error.ToHttpResult();
    }
}
