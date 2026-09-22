using FluentValidation;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.UserLibrary.AddOrUpdateUserLibrary;

public record AddOrUpdateUserLibraryCommand(string UserId, Guid MangaId, string Status, bool IsFavorite) : ICommand<UserLibraryResponse>;

public class AddOrUpdateUserLibraryCommandValidator : AbstractValidator<AddOrUpdateUserLibraryCommand>
{
    public AddOrUpdateUserLibraryCommandValidator()
    {
        RuleFor(x => x.UserId).NotEmpty().WithMessage("UserId is required.");
        RuleFor(x => x.MangaId).NotEmpty().WithMessage("MangaId is required.");
    }
}

internal sealed class AddOrUpdateUserLibraryCommandHandler(
    IUserLibraryRepository libraryRepository,
    IMangaRepository mangaRepository)
    : ICommandHandler<AddOrUpdateUserLibraryCommand, UserLibraryResponse>
{
    public async Task<Result<UserLibraryResponse>> Handle(AddOrUpdateUserLibraryCommand command, CancellationToken ct)
    {
        var existing = await libraryRepository.GetByUserIdAndMangaIdAsync(command.UserId, MangaId.From(command.MangaId), ct);
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(command.MangaId), ct,true);
        if (existing is not null)
        {
            existing.UpdateLibrary(command.Status, command.IsFavorite);
            await libraryRepository.UpdateAsync(existing, ct);
            
            return new UserLibraryResponse(existing.Id, existing.UserId, existing.MangaId.Value, existing.AddedAt, existing.UpdatedAt, existing.Status, existing.IsFavorite, manga.Adapt<MangaSummaryResponse>());
        }

        var library = Aggregates.UserLibrary.Create(command.UserId, MangaId.From(command.MangaId), status: command.Status);
        await libraryRepository.AddAsync(library, ct);

        return new UserLibraryResponse(library.Id, library.UserId, library.MangaId.Value, library.AddedAt, library.UpdatedAt, library.Status, library.IsFavorite, manga.Adapt<MangaSummaryResponse>());
    }
}

public sealed class AddOrUpdateUserLibraryEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/user-library").WithTags("UserLibrary");

        group.MapPost("/", async (AddOrUpdateUserLibraryCommand cmd, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(cmd, ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        })
        .RequireAuthorization()
        .WithName("AddUserLibrary");
    }
}
