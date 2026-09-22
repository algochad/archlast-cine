using System.Security.Claims;
using FluentValidation;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.Infrastructure.Authentication;
using NovaStack.SharedKernel.Abstractions;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Users.RegisterFcmToken;

public record RegisterFcmTokenRequest(string FcmToken);

public record RegisterFcmTokenCommand(Guid UserId, string FcmToken) : ICommand;

public class RegisterFcmTokenCommandValidator : AbstractValidator<RegisterFcmTokenCommand>
{
    public RegisterFcmTokenCommandValidator()
    {
        RuleFor(x => x.UserId).NotEmpty().WithMessage("UserId is required.");
        RuleFor(x => x.FcmToken).NotEmpty().WithMessage("FcmToken is required.");
    }
}

public sealed class RegisterFcmTokenCommandHandler(IUserRepository userRepository)
    : ICommandHandler<RegisterFcmTokenCommand>
{
    public async Task<Result> Handle(RegisterFcmTokenCommand command, CancellationToken ct)
    {
        var user = await userRepository.GetByIdAsync(UserId.From(command.UserId), ct);
        if (user is null)
            return Error.NotFound("User.NotFound", $"User with Id '{command.UserId}' was not found.");

        await userRepository.AddFcmTokenAsync(user.Id, command.FcmToken, ct);
        return Result.Success();
    }
}

public sealed class RegisterFcmTokenEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/users").WithTags("Users");

        group.MapPost("/fcm-token", async (
                [FromBody]RegisterFcmTokenRequest request,
            IClaimService claimService,
            ISender sender,
            CancellationToken ct) =>
            {
                var userIdStr = claimService.GetCurrentUserId();
            if (string.IsNullOrEmpty(userIdStr) || !Guid.TryParse(userIdStr, out var userId))
                return Results.Unauthorized();

            var res = await sender.Send(new RegisterFcmTokenCommand(userId, request.FcmToken), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok("FCM token registered successfully.")) : res.Error.ToHttpResult();
        })
        .RequireAuthorization()
        .WithName("RegisterFcmToken")
        .WithSummary("Register device FCM token for push notifications")
        .Produces<ApiResponse<string>>();
    }
}
