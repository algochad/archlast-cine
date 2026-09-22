using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.UserLibrary.RemoveUserLibrary;

public record RemoveUserLibraryCommand(Guid Id) : ICommand;

internal sealed class RemoveUserLibraryCommandHandler(IUserLibraryRepository libraryRepository)
    : ICommandHandler<RemoveUserLibraryCommand>
{
    public async Task<Result> Handle(RemoveUserLibraryCommand command, CancellationToken ct)
    {
        await libraryRepository.DeleteAsync(command.Id, ct);
        return Result.Success();
    }
}

public sealed class RemoveUserLibraryEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/user-library").WithTags("UserLibrary");

        group.MapDelete("/{id:guid}", async (Guid id, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new RemoveUserLibraryCommand(id), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok<object?>(null, "Removed")) : res.Error.ToHttpResult();
        })
        .RequireAuthorization()
        .WithName("RemoveUserLibrary");
    }
}
