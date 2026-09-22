using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Users.GetPagedUser;

public record GetPagedUserQuery(
    string? Search = null,
    int Page = 1,
    int PageSize = 10,
    string? SortBy = "createdAt",
    string? OrderBy = "desc") : IQuery<PagedResponse<UserResponse>>;

public sealed class GetPagedUserQueryHandler(IUserRepository userRepository) : IQueryHandler<GetPagedUserQuery, PagedResponse<UserResponse>>
{
    public async Task<Result<PagedResponse<UserResponse>>> Handle(GetPagedUserQuery request, CancellationToken cancellationToken)
    {
        var data = await userRepository.GetPagedAsync(request.Search, request.SortBy ?? "createdAt", request.OrderBy ?? "desc", request.Page, request.PageSize, cancellationToken);
        var mapped = data.Items.Select(usr =>
        {
            return new UserResponse(usr.Id.Value, usr.Username, usr.Email, usr.Roles, usr.IsActive, usr.FirebaseUid, usr.CreatedAt, usr.LastActiveAt, usr.ClientIpAddress);
        });

        return PagedResponse<UserResponse>.Create(
            mapped,
            data.Page,
            data.PageSize,
            data.TotalCount);
    }
}

public sealed class GetPagedUserEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/users").WithTags("Users");

        group.MapGet("/", async (ISender sender, CancellationToken ct,
                string? search = null,
                int page = 1,
                int pageSize = 10,
                string? sortBy = "updatedAt",
                string? orderBy = "desc") =>
        {
            var res = await sender.Send(new GetPagedUserQuery(search, page, pageSize, sortBy, orderBy), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("GetPagedUser")
        .WithDescription("Get paged users")
        .WithTags("Users")
        .Produces<ApiResponse<PagedResponse<UserResponse>>>();
    }
}
