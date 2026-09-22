using System.Security.Claims;
using FluentValidation;
using Isopoh.Cryptography.Argon2;
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

namespace MangaScrapper.Core.Features.Auth.Register;

public record RegisterCommand(string Username, string Password, string Email, string? ClientIpAddress = null) : ICommand<LoginResponse>;

public sealed class RegisterCommandValidator : AbstractValidator<RegisterCommand>
{
    public RegisterCommandValidator()
    {
        RuleFor(x => x.Username).NotEmpty().MinimumLength(3).MaximumLength(50);
        RuleFor(x => x.Password).NotEmpty().MinimumLength(6);
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
    }
}

internal sealed class RegisterCommandHandler(
    IUserRepository userRepository,
    IAuthTokenService authTokenService) : ICommandHandler<RegisterCommand, LoginResponse>
{
    public async Task<Result<LoginResponse>> Handle(RegisterCommand command, CancellationToken ct)
    {
        var existingUser = await userRepository.GetByUsernameAsync(command.Username, ct);
        if (existingUser is not null)
        {
            return Error.Conflict("Auth.UsernameTaken", "Username already exists.");
        }

        // First user ever gets superuser role, otherwise "user"
        var superuserCount = await userRepository.CountByRoleAsync("superuser", ct);
        var role = superuserCount == 0 ? "superuser" : "user";

        var user = User.Create(
            UserId.New(),
            command.Username,
            Argon2.Hash(command.Password),
            command.Email,
            new List<string> { role },
            lastActiveAt: DateTime.UtcNow,
            clientIpAddress: command.ClientIpAddress);

        await userRepository.AddAsync(user, ct);

        var (token, expiry) = authTokenService.GenerateToken(user, expiryDays: 7);
        return new LoginResponse(token, expiry, user.Username, user.Id.Value);
    }
}

public sealed class RegisterEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/auth/register", HandleAsync)
            .WithName("Register")
            .WithSummary("Register a new user account")
            .WithTags("Auth")
            .RequireRateLimiting(RateLimitPolicies.Auth)
            .Produces<ApiResponse<LoginResponse>>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .AllowAnonymous();
    }

    private static async Task<IResult> HandleAsync(
        RegisterRequest request,
        ISender sender,
        IUserRepository userRepository,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var clientIp = httpContext.GetClientIpAddress();
        var command = new RegisterCommand(request.Username, request.Password, request.Email, clientIp);
        var result = await sender.Send(command, ct);

        if (!result.IsSuccess)
        {
            return result.Error.ToHttpResult();
        }

        // Sign the new user in with a cookie session as well
        var user = await userRepository.GetByUsernameAsync(request.Username, ct);
        if (user != null)
        {
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.Value.ToString()),
                new Claim(ClaimTypes.Name, user.Email),
                new Claim("Username", user.Username)
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

        return Results.Created("/api/auth/me", ApiResponse.Ok(result.Value, "Registration successful."));
    }
}
