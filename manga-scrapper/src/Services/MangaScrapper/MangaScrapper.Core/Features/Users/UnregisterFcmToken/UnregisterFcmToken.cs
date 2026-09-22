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
using NovaStack.SharedKernel.Abstractions;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Users.UnregisterFcmToken;

public record UnregisterFcmTokenRequest(string FcmToken);

public record UnregisterFcmTokenCommand(Guid UserId, string FcmToken) : ICommand;

public class UnregisterFcmTokenCommandValidator : AbstractValidator<UnregisterFcmTokenCommand>
{
    public UnregisterFcmTokenCommandValidator()
    {
        RuleFor(x => x.UserId).NotEmpty().WithMessage("UserId is required.");
        RuleFor(x => x.FcmToken).NotEmpty().WithMessage("FcmToken is required.");
    }
}

public sealed class UnregisterFcmTokenCommandHandler(IUserRepository userRepository)
    : ICommandHandler<UnregisterFcmTokenCommand>
{
    public async Task<Result> Handle(UnregisterFcmTokenCommand command, CancellationToken ct)
    {
        var user = await userRepository.GetByIdAsync(UserId.From(command.UserId), ct);
        if (user is null)
            return Error.NotFound("User.NotFound", $"User with Id '{command.UserId}' was not found.");

        await userRepository.RemoveFcmTokenAsync(user.Id, command.FcmToken, ct);
        return Result.Success();
    }
}

public sealed class UnregisterFcmTokenEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/users").WithTags("Users");

        group.MapDelete("/fcm-token", async (
            [FromBody]UnregisterFcmTokenRequest request,
            IClaimService claimService,
            ISender sender,
            CancellationToken ct) =>
        {
            var userIdStr = claimService.GetCurrentUserId();
            if (string.IsNullOrEmpty(userIdStr) || !Guid.TryParse(userIdStr, out var userId))
                return Results.Unauthorized();

            var res = await sender.Send(new UnregisterFcmTokenCommand(userId, request.FcmToken), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok("FCM token removed successfully.")) : res.Error.ToHttpResult();
        })
        .RequireAuthorization()
        .WithName("UnregisterFcmToken")
        .WithSummary("Unregister device FCM token upon logout")
        .Produces<ApiResponse<string>>();
    }
}
