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

namespace MangaScrapper.Core.Features.Scrapper.ScrapChapterPages;

public record ScrapChapterPagesCommand(Guid MangaId) : ICommand<int>;

public record CancelScrapingRequest(Guid? MangaId = null, Guid? ChapterId = null, bool CancelAll = false);

internal sealed class ScrapChapterPagesCommandHandler(
    IMangaRepository mangaRepository,
    IScrapperQueueService queueService,
    IScrapingProcessTracker? processTracker = null)
    : ICommandHandler<ScrapChapterPagesCommand, int>
{
    public async Task<Result<int>> Handle(ScrapChapterPagesCommand command, CancellationToken ct)
    {
        var manga = await mangaRepository.GetByIdAsync(new MangaId(command.MangaId), ct);
        if (manga is null)
            return Error.NotFound("Manga.NotFound", $"Manga with ID '{command.MangaId}' was not found.");

        var queuedCount = 0;
        foreach (var chapter in manga.Chapters.OrderBy(x => x.Number))
        {
            if (chapter.Pages.Count == 0)
            {
                await queueService.QueueChapterScraping(manga.Id.Value, manga.Title, chapter);
                processTracker?.TrackQueued(manga.Id.Value, manga.Title, chapter.Id.Value, chapter.Number);
                queuedCount++;
            }
        }

        return queuedCount;
    }
}

public sealed class ScrapChapterPagesEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper")
            .WithTags("Scrapper");

        group.MapGet("/manga/{mangaId:guid}/chapter-pages", async (Guid mangaId, ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new ScrapChapterPagesCommand(mangaId), ct);
            return res.IsSuccess
                ? Results.Ok(ApiResponse.Ok(new { Message = $"Scraping {res.Value} jobs queued for missing chapters." }))
                : res.Error.ToHttpResult();
        })
        .WithName("ScrapChapterPages")
        .RequireRateLimiting(RateLimitPolicies.Scraping);

        group.MapGet("/processes", async (
            IScrapingProcessTracker processTracker,
            IScrapperQueueService queueService,
            CancellationToken ct) =>
        {
            var processes = processTracker.GetAllProcesses();
            var queueStats = await queueService.GetQueuedJobsAsync();
            return Results.Ok(ApiResponse.Ok(new
            {
                Processes = processes,
                QueueStats = queueStats.Select(q => new { Id = q.Id, JobName = q.JobName, State = q.State })
            }));
        })
        .WithName("GetScrapingProcesses")
        .DisableRateLimiting();

        group.MapPost("/cancel", async (
            CancelScrapingRequest req,
            IScrapperQueueService queueService,
            CancellationToken ct) =>
        {
            await queueService.CancelScrapingAsync(req.MangaId, req.ChapterId, req.CancelAll, ct);
            return Results.Ok(ApiResponse.Ok(new { Message = "Cancellation processed successfully." }));
        }).WithName("CancelScrapingProcess");

        group.MapPost("/purge", async (
            IScrapperQueueService queueService,
            CancellationToken ct) =>
        {
            var count = await queueService.PurgeQueueAsync(ct);
            return Results.Ok(ApiResponse.Ok(new { Message = $"Queue purged successfully ({count} messages removed)." }));
        }).WithName("PurgeScrapingQueue");
    }
}

