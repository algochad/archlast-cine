using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Persistence.Documents;
using MangaScrapper.Core.Scrapers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;
using NovaStack.Infrastructure.Messaging.Options;
using RabbitMQ.Client;

namespace MangaScrapper.Core.Services;

/// <summary>
/// Infrastructure implementation that routes chapter scraping to the correct provider
/// and publishes RabbitMQ integration events. Bridges the domain <see cref="Chapter"/> to the
/// infrastructure <see cref="ChapterDocument"/> expected by <see cref="IScrapperService"/>.
/// </summary>
public sealed class ScrapperQueueService : IScrapperQueueService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly RabbitMqOptions _rabbitMqOptions;
    private readonly ILogger<ScrapperQueueService> _logger;
    private const string ScrapingQueueName = "scrape-chapter-pages";

    public ScrapperQueueService(
        IServiceProvider serviceProvider, 
        IOptions<MessagingOptions> messagingOptions,
        ILogger<ScrapperQueueService> logger)
    {
        _serviceProvider = serviceProvider;
        _rabbitMqOptions = messagingOptions.Value.RabbitMQ;
        _logger = logger;
    }


    public async Task QueueChapterScraping(Guid mangaId, string mangaTitle, Chapter chapter)
    {
        var providerKey = chapter.ChapterProvider?.ToLowerInvariant() switch
        {
            "komiku"     => "komiku",
            "kiryuu"     => "kiryuu",
            "komikcast"  => "komikcast",
            "mangadex"   => "mangadex",
            "komiktap"   => "komiktap",
            "manhwadesu" => "manhwadesu",
            "doujindesu" => "doujindesu",
            "softkomik"  => "softkomik",
            _            => null
        };

        if (providerKey is null) return;

        var service = _serviceProvider.GetKeyedService<IScrapperService>(providerKey);
        if (service is null) return;

        await service.QueueChapterScraping(mangaId, mangaTitle, chapter);
    }

    /// <summary>
    /// Inspects the RabbitMQ <c>scrape-chapter-pages</c> queue using a passive declare
    /// (no side-effects) and returns a summary entry with the current message count.
    /// Individual message enumeration is not possible via AMQP without consuming messages,
    /// so a single aggregate entry per queue is returned.
    /// </summary>
    public async Task<List<(string Id, string JobName, string State)>> GetQueuedJobsAsync()
    {
        var items = new List<(string, string, string)>();

        try
        {
            var factory = new ConnectionFactory
            {
                HostName  = _rabbitMqOptions.Host,
                Port      = _rabbitMqOptions.Port,
                VirtualHost = _rabbitMqOptions.VirtualHost,
                UserName  = _rabbitMqOptions.Username,
                Password  = _rabbitMqOptions.Password
            };

            await using var connection = await factory.CreateConnectionAsync();
            await using var channel   = await connection.CreateChannelAsync();

            // Passive declare: does not create the queue, only reads its current stats.
            var result = await channel.QueueDeclarePassiveAsync(ScrapingQueueName);

            // RabbitMQ returns MessageCount (ready) and ConsumerCount.
            // "Processing" messages are those acknowledged by a consumer but not yet acked (unacked).
            // We surface ready messages and consumer count as the observable state.
            if (result.MessageCount > 0)
                items.Add((
                    Guid.CreateVersion7().ToString(),
                    ScrapingQueueName,
                    $"Enqueued ({result.MessageCount} ready, {result.ConsumerCount} consumer(s))"
                ));
            else
                items.Add((
                    Guid.CreateVersion7().ToString(),
                    ScrapingQueueName,
                    $"Idle (0 ready, {result.ConsumerCount} consumer(s))"
                ));
        }
        catch (Exception ex) when (
            ex is RabbitMQ.Client.Exceptions.BrokerUnreachableException
            or RabbitMQ.Client.Exceptions.OperationInterruptedException)
        {
            // Queue does not exist yet or broker is unavailable — return empty.
            items.Add((Guid.CreateVersion7().ToString(), ScrapingQueueName, "Unavailable"));
        }

        return items;
    }

    public async Task<int> PurgeQueueAsync(CancellationToken ct = default)
    {
        try
        {
            var factory = new ConnectionFactory
            {
                HostName  = _rabbitMqOptions.Host,
                Port      = _rabbitMqOptions.Port,
                VirtualHost = _rabbitMqOptions.VirtualHost,
                UserName  = _rabbitMqOptions.Username,
                Password  = _rabbitMqOptions.Password
            };

            await using var connection = await factory.CreateConnectionAsync(ct);
            await using var channel = await connection.CreateChannelAsync(cancellationToken: ct);

            var purgedCount = await channel.QueuePurgeAsync(ScrapingQueueName, cancellationToken: ct);
            _logger.LogInformation("Purged {PurgedCount} messages from queue {QueueName}", purgedCount, ScrapingQueueName);
            return (int)purgedCount;

        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to purge queue {QueueName}", ScrapingQueueName);
            return 0;
        }
    }

    public async Task CancelScrapingAsync(Guid? mangaId = null, Guid? chapterId = null, bool cancelAll = false, CancellationToken ct = default)
    {
        _logger.LogInformation("CancelScraping requested: MangaId={MangaId}, ChapterId={ChapterId}, CancelAll={CancelAll}", mangaId, chapterId, cancelAll);

        if (cancelAll)
        {
            await PurgeQueueAsync(ct);
        }

        // 1. Mark in tracker immediately
        var tracker = _serviceProvider.GetService<IScrapingProcessTracker>();
        tracker?.MarkCancelled(mangaId, chapterId, cancelAll);

        // 2. Cancel in local cancellation manager if running in the same process
        var cancellationManager = _serviceProvider.GetService<IScrapingCancellationManager>();
        cancellationManager?.Cancel(mangaId, chapterId, cancelAll);

        // 3. Publish cancellation integration event to RabbitMQ so Scrapper.Worker catches and cancels active downloads
        var eventBus = _serviceProvider.GetService<IEventBus>();
        if (eventBus != null)
        {
            await eventBus.PublishAsync(
                new CancelScrapingIntegrationEvent(mangaId, chapterId, cancelAll),
                "cancel-scraping",
                ct);
        }
    }
}

