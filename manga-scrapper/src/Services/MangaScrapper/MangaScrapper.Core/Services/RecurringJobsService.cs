using Hangfire;
using Hangfire.Storage;
using MangaScrapper.Core.BackgroundJobs;
using MangaScrapper.Core.Common.Abstractions;
using RecurringJobDto = MangaScrapper.Core.Features.RecurringJobs.GetRecurringJobs.RecurringJobDto;

namespace MangaScrapper.Core.Services;

public class RecurringJobsService(IRecurringJobManager recurringJobManager) : IRecurringJobsService
{
    public Task<List<RecurringJobDto>> GetRecurringJobsAsync(CancellationToken ct = default)
    {
        var connection = JobStorage.Current.GetConnection();
        var jobs = connection.GetRecurringJobs()
            .Select(j => new RecurringJobDto(
                j.Id,
                j.Cron,
                j.Queue,
                j.NextExecution,
                j.LastExecution,
                j.LastJobState,
                j.CreatedAt
            )).ToList();

        return Task.FromResult(jobs);
    }

    public Task CreateOrUpdateLatestChapterScrapingJobAsync(string jobId, string cronExpression, string provider, int scrapLastTotalPage, CancellationToken ct = default)
    {
        recurringJobManager.AddOrUpdate<LatestChapterScrapingJob>(
            jobId,
            job => job.ExecuteAsync(scrapLastTotalPage, provider, CancellationToken.None),
            cronExpression
        );
        return Task.CompletedTask;
    }

    public Task DeleteRecurringJobAsync(string jobId, CancellationToken ct = default)
    {
        recurringJobManager.RemoveIfExists(jobId);
        return Task.CompletedTask;
    }

    public Task TriggerRecurringJobAsync(string jobId, CancellationToken ct = default)
    {
        recurringJobManager.Trigger(jobId);
        return Task.CompletedTask;
    }
}
