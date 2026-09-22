using FluentValidation;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.UserProgression.UpdateUserProgression;

public record UpdateUserProgressionCommand(
    string UserId,
    Guid MangaId,
    Guid ChapterId,
    double ChapterNumber,
    int LastReadPage,
    int TotalPages,
    bool IsCompleted,
    int ReadingTimeSeconds) : ICommand<UserProgressionResponse>;

public class UpdateUserProgressionCommandValidator : AbstractValidator<UpdateUserProgressionCommand>
{
    public UpdateUserProgressionCommandValidator()
    {
        RuleFor(x => x.UserId).NotEmpty().WithMessage("UserId is required.");
        RuleFor(x => x.MangaId).NotEmpty().WithMessage("MangaId is required.");
        RuleFor(x => x.ChapterId).NotEmpty().WithMessage("ChapterId is required.");
    }
}

internal sealed class UpdateUserProgressionCommandHandler(IUserProgressionRepository progressionRepository)
    : ICommandHandler<UpdateUserProgressionCommand, UserProgressionResponse>
{
    public async Task<Result<UserProgressionResponse>> Handle(UpdateUserProgressionCommand command, CancellationToken ct)
    {
        var mangaId = MangaId.From(command.MangaId);
        var chapterLog = Aggregates.UserProgression.ChapterLog.Create(
            command.ChapterId, command.ChapterNumber, command.LastReadPage, 
            command.TotalPages, command.IsCompleted, command.ReadingTimeSeconds);

        var existing = await progressionRepository.GetByUserIdAndMangaIdAsync(command.UserId, mangaId, ct);
        if (existing is not null)
        {
            existing.UpdateProgression(chapterLog);
            await progressionRepository.AddOrUpdateAsync(existing, ct);
            return new UserProgressionResponse(
                existing.Id, existing.UserId, existing.MangaId.Value, existing.LastReadAt, existing.TotalReadingTime, 
                existing.ChapterLogs.Select(cl => new ChapterLogsResponse(cl.Id, cl.ChapterId, cl.ChapterNumber, cl.LastReadPage, cl.TotalPages, cl.IsCompleted, cl.ReadingTimeSeconds, cl.LastReadAt)).ToList()
            );
        }

        var progression = Aggregates.UserProgression.Create(command.UserId, mangaId, chapterLog.ReadingTimeSeconds, new List<Aggregates.UserProgression.ChapterLog> { chapterLog });
        await progressionRepository.AddOrUpdateAsync(progression, ct);

        return new UserProgressionResponse(
            progression.Id, progression.UserId, progression.MangaId.Value, progression.LastReadAt, progression.TotalReadingTime, 
            progression.ChapterLogs.Select(cl => new ChapterLogsResponse(cl.Id, cl.ChapterId, cl.ChapterNumber, cl.LastReadPage, cl.TotalPages, cl.IsCompleted, cl.ReadingTimeSeconds, cl.LastReadAt)).ToList()
        );
    }
}

public sealed class UpdateUserProgressionEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/user-progression").WithTags("UserProgression");

        group.MapPost("/", async (UpdateUserProgressionCommand cmd, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(cmd, ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("UpdateUserProgression")
        .Produces<ApiResponse<UserProgressionResponse>>();
    }
}
