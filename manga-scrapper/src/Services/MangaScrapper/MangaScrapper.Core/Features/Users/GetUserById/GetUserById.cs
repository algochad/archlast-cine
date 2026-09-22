using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Users.GetUserById;

public record GetUserByIdQuery(Guid Id) : IQuery<UserResponse>;

public sealed class GetUserByIdQueryHandler(IUserRepository userRepository) : IQueryHandler<GetUserByIdQuery, UserResponse>
{
    public async Task<Result<UserResponse>> Handle(GetUserByIdQuery request, CancellationToken cancellationToken)
    {
        var user = await userRepository.GetByIdAsync(UserId.From(request.Id), cancellationToken);
        if (user is null)
            return Error.NotFound("User.NotFound", $"User with Id '{request.Id}' was not found.");
        return new UserResponse(user.Id.Value, user.Username, user.Email, user.Roles, user.IsActive, user.FirebaseUid, user.CreatedAt, user.LastActiveAt, user.ClientIpAddress);
    }
}

public sealed class GetUserByIdEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/users").WithTags("Users");

        group.MapGet("/{userId}", async (Guid userId, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new GetUserByIdQuery(userId), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetUserById")
        .WithDescription("Get user by id")
        .WithTags("Users")
        .Produces<ApiResponse<UserResponse>>();
    }
}
