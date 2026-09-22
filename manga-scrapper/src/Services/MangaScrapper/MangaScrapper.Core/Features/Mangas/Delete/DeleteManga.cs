using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.Delete;

public record DeleteMangaCommand(Guid MangaId) : ICommand;

internal sealed class DeleteMangaCommandHandler(
    IMangaRepository mangaRepository,
    IMangaMessagePublisher messagePublisher)
    : ICommandHandler<DeleteMangaCommand>
{
    public async Task<Result> Handle(DeleteMangaCommand command, CancellationToken ct)
    {
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(command.MangaId), ct);
        if (manga is null)
            return Error.NotFound("Manga.NotFound", $"Manga with Id '{command.MangaId}' was not found.");

        await messagePublisher.PublishMangaDeletedAsync(
            manga.Id.Value, 
            manga.Title, 
            ct);

        return Result.Success();
    }
}

public record DeleteChapterCommand(Guid MangaId, Guid ChapterId) : ICommand;

internal sealed class DeleteChapterCommandHandler(
    IMangaRepository mangaRepository,
    IMangaMessagePublisher messagePublisher)
    : ICommandHandler<DeleteChapterCommand>
{
    public async Task<Result> Handle(DeleteChapterCommand command, CancellationToken ct)
    {
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(command.MangaId), ct);
        if (manga is null)
            return Error.NotFound("Manga.NotFound", $"Manga with Id '{command.MangaId}' was not found.");

        var chapter = manga.Chapters.FirstOrDefault(c => c.Id.Value == command.ChapterId);
        if (chapter is null)
            return Error.NotFound("Chapter.NotFound", $"Chapter with Id '{command.ChapterId}' was not found.");

        await messagePublisher.PublishChapterDeletedAsync(
            manga.Id.Value, 
            manga.Title, 
            chapter.Id.Value, 
            chapter.Number, 
            ct);

        return Result.Success();
    }
}

public sealed class DeleteMangaEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapDelete("/api/v1/manga/{mangaId:guid}", HandleDeleteMangaAsync)
            .WithName("DeleteManga")
            .RequireAuthorization(User.UserRoles.SuperUser)
            .RequireRateLimiting(RateLimitPolicies.Default)
            .WithSummary("Delete a manga")
            .WithTags("Manga")
            .Produces<ApiResponse<object>>();

        app.MapDelete("/api/v1/manga/{mangaId:guid}/chapter/{chapterId:guid}", HandleDeleteChapterAsync)
            .WithName("DeleteChapter")
            .RequireAuthorization(User.UserRoles.SuperUser)
            .RequireRateLimiting(RateLimitPolicies.Default)
            .WithSummary("Delete a manga chapter")
            .WithTags("Manga")
            .Produces<ApiResponse<object>>();
    }

    private static async Task<IResult> HandleDeleteMangaAsync(Guid mangaId, ISender sender, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteMangaCommand(mangaId), ct);
        return result.IsSuccess 
            ? Results.Ok(ApiResponse.Ok<object?>(null, "Manga deletion queued successfully")) 
            : result.Error.ToHttpResult();
    }

    private static async Task<IResult> HandleDeleteChapterAsync(Guid mangaId, Guid chapterId, ISender sender, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteChapterCommand(mangaId, chapterId), ct);
        return result.IsSuccess 
            ? Results.Ok(ApiResponse.Ok<object?>(null, "Chapter deletion queued successfully")) 
            : result.Error.ToHttpResult();
    }
}
