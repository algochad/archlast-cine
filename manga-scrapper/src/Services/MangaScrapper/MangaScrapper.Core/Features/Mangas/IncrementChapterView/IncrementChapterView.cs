using FluentValidation;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Mangas.IncrementChapterView;

public record IncrementChapterViewCommand(Guid ChapterId, Guid? MangaId = null) : ICommand;

public class IncrementChapterViewCommandValidator : AbstractValidator<IncrementChapterViewCommand>
{
    public IncrementChapterViewCommandValidator()
    {
        RuleFor(x => x.ChapterId).NotEmpty().WithMessage("ChapterId is required.");
    }
}

public sealed class IncrementChapterViewCommandHandler(IMangaRepository mangaRepository)
    : ICommandHandler<IncrementChapterViewCommand>
{
    public async Task<Result> Handle(IncrementChapterViewCommand command, CancellationToken ct)
    {
        var updated = await mangaRepository.IncrementChapterViewAsync(command.ChapterId, command.MangaId, ct);
        if (!updated)
        {
            return Error.NotFound("Chapter.NotFound", $"Chapter with Id '{command.ChapterId}' was not found.");
        }

        return Result.Success();
    }
}

public sealed class IncrementChapterViewEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/manga")
            .WithTags("Manga")
            .RequireRateLimiting(RateLimitPolicies.MangaView);

        group.MapPost("/{mangaId:guid}/chapters/{chapterId:guid}/view", async (Guid mangaId, Guid chapterId, ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(new IncrementChapterViewCommand(chapterId, mangaId), ct);
            return result.IsSuccess
                ? Results.Ok(ApiResponse.Ok<object?>(null, "Chapter view incremented successfully"))
                : result.Error.ToHttpResult();
        })
        .WithName("IncrementChapterViewWithMangaId")
        .WithSummary("Increment view count for a specific manga chapter")
        .Produces<ApiResponse<object>>();

        group.MapPost("/{mangaId:guid}/chapter/{chapterId:guid}/view", async (Guid mangaId, Guid chapterId, ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(new IncrementChapterViewCommand(chapterId, mangaId), ct);
            return result.IsSuccess
                ? Results.Ok(ApiResponse.Ok<object?>(null, "Chapter view incremented successfully"))
                : result.Error.ToHttpResult();
        })
        .WithName("IncrementSingleChapterViewWithMangaId")
        .WithSummary("Increment view count for a specific manga chapter")
        .Produces<ApiResponse<object>>();

        group.MapPost("/chapters/{chapterId:guid}/view", async (Guid chapterId, ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(new IncrementChapterViewCommand(chapterId), ct);
            return result.IsSuccess
                ? Results.Ok(ApiResponse.Ok<object?>(null, "Chapter view incremented successfully"))
                : result.Error.ToHttpResult();
        })
        .WithName("IncrementChapterView")
        .WithSummary("Increment view count for a chapter by chapter ID")
        .Produces<ApiResponse<object>>();

        group.MapPost("/chapter/{chapterId:guid}/view", async (Guid chapterId, ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(new IncrementChapterViewCommand(chapterId), ct);
            return result.IsSuccess
                ? Results.Ok(ApiResponse.Ok<object?>(null, "Chapter view incremented successfully"))
                : result.Error.ToHttpResult();
        })
        .WithName("IncrementSingleChapterView")
        .WithSummary("Increment view count for a chapter by chapter ID")
        .Produces<ApiResponse<object>>();
    }
}
