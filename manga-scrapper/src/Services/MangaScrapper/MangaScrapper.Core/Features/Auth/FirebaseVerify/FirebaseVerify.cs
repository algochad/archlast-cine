using System.Security.Claims;
using FirebaseAdmin.Auth;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using MediatR;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.Infrastructure.Http;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Auth.FirebaseVerify;

public record FirebaseVerifyCommand(string IdToken, string? ClientIpAddress = null) : ICommand<LoginResponse>;

internal sealed class FirebaseVerifyCommandHandler(
    IUserRepository userRepository,
    IAuthTokenService authTokenService) : ICommandHandler<FirebaseVerifyCommand, LoginResponse>
{
    public async Task<Result<LoginResponse>> Handle(FirebaseVerifyCommand command, CancellationToken ct)
    {
        // Verify Firebase token
        FirebaseToken decodedToken;
        try
        {
            decodedToken = await FirebaseAuth.DefaultInstance
                .VerifyIdTokenAsync(command.IdToken, cancellationToken: ct);
        }
        catch (Exception)
        {
            return Error.Unauthorized("Firebase.InvalidToken", "Firebase ID token is invalid or expired.");
        }

        var uid = decodedToken.Uid;
        var email = decodedToken.Claims.TryGetValue("email", out var emailClaim)
            ? emailClaim.ToString() ?? string.Empty
            : string.Empty;
        var name = decodedToken.Claims.TryGetValue("name", out var nameClaim)
            ? nameClaim.ToString() ?? string.Empty
            : string.Empty;

        if (string.IsNullOrEmpty(email))
        {
            return Error.Validation("Firebase.NoEmail", "Firebase token does not contain an email claim.");
        }

        // Find or create user
        var user = await userRepository.GetByFirebaseUidOrEmailAsync(uid, email, ct);
        if (user is null)
        {
            // Auto-derive username from display name or email prefix
            var username = string.IsNullOrEmpty(name)
                ? email.Split('@')[0]
                : name.Replace(" ", "").ToLower();

            // Ensure uniqueness
            var existingByUsername = await userRepository.GetByUsernameAsync(username, ct);
            if (existingByUsername is not null)
            {
                username = $"{username}_{Guid.CreateVersion7().ToString()[..6]}";
            }

            user = User.Create(
                UserId.New(),
                username,
                string.Empty, // no password for Firebase users
                email,
                new List<string> { "user" },
                firebaseUid: uid,
                lastActiveAt: DateTime.UtcNow,
                clientIpAddress: command.ClientIpAddress);

            await userRepository.AddAsync(user, ct);
        }
        else
        {
            if (string.IsNullOrEmpty(user.FirebaseUid))
            {
                // Link existing email/password account with Firebase UID
                user.FirebaseUid = uid;
            }

            user.LastActiveAt = DateTime.UtcNow;
            if (!string.IsNullOrWhiteSpace(command.ClientIpAddress))
            {
                user.ClientIpAddress = command.ClientIpAddress;
            }

            await userRepository.UpdateAsync(user, ct);
        }

        var (token, expiry) = authTokenService.GenerateToken(user, expiryDays: 30);
        return new LoginResponse(token, expiry, user.Username, user.Id.Value);
    }
}

public sealed class FirebaseVerifyEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/auth/firebase", HandleAsync)
            .WithName("FirebaseVerify")
            .WithSummary("Authenticate via Firebase ID token")
            .WithTags("Auth")
            .RequireRateLimiting(RateLimitPolicies.Auth)
            .Produces<ApiResponse<LoginResponse>>()
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .AllowAnonymous();
    }

    private static async Task<IResult> HandleAsync(
        FirebaseVerifyRequest request,
        ISender sender,
        IUserRepository userRepository,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var clientIp = httpContext.GetClientIpAddress();
        var command = new FirebaseVerifyCommand(request.IdToken, clientIp);
        var result = await sender.Send(command, ct);

        if (!result.IsSuccess)
        {
            return result.Error.ToHttpResult();
        }

        // Also sign the user in with a cookie for browser-based clients
        var user = await userRepository.GetByUsernameAsync(result.Value.Username, ct);
        if (user != null)
        {
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.Value.ToString()),
                new Claim(ClaimTypes.Name, user.Email),
                new Claim("Username", user.Username),
                new Claim("FirebaseUid", user.FirebaseUid ?? string.Empty)
            };
            foreach (var role in user.Roles)
            {
                claims.Add(new Claim(ClaimTypes.Role, role));
            }

            var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
            await httpContext.SignInAsync(
                CookieAuthenticationDefaults.AuthenticationScheme,
                new ClaimsPrincipal(identity),
                new AuthenticationProperties { AllowRefresh = true });
        }

        return Results.Ok(ApiResponse.Ok(result.Value));
    }
}
