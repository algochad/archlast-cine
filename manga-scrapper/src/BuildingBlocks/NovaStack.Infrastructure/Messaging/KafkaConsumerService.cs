using System.Text.Json;
using Confluent.Kafka;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging.Options;

namespace NovaStack.Infrastructure.Messaging;

/// <summary>
/// A native Kafka background consumer service that runs a message consume loop
/// on a topic and processes events using an injected <see cref="IIntegrationEventHandler{TEvent}"/>.
/// </summary>
public sealed class KafkaConsumerService<TEvent, THandler> : BackgroundService
    where TEvent : class, IIntegrationEvent
    where THandler : class, IIntegrationEventHandler<TEvent>
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<KafkaConsumerService<TEvent, THandler>> _logger;
    private readonly KafkaOptions _options;
    private readonly string _topic;
    private readonly string _groupId;

    public KafkaConsumerService(
        IServiceProvider serviceProvider,
        ILogger<KafkaConsumerService<TEvent, THandler>> logger,
        KafkaOptions options,
        string topic,
        string? groupId = null)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _options = options;
        _topic = topic;
        _groupId = groupId ?? options.GroupId;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Run consumer loop on background thread since Consume is blocking
        Task.Run(async () =>
        {
            var config = new ConsumerConfig
            {
                BootstrapServers = _options.BootstrapServers,
                GroupId = _groupId,
                AutoOffsetReset = AutoOffsetReset.Earliest,
                EnableAutoCommit = false,
                SecurityProtocol = Enum.TryParse<SecurityProtocol>(_options.SecurityProtocol, out var protocol) 
                    ? protocol 
                    : SecurityProtocol.Plaintext
            };

            if (!string.IsNullOrWhiteSpace(_options.SaslUsername))
            {
                config.SaslMechanism = SaslMechanism.Plain;
                config.SaslUsername = _options.SaslUsername;
                config.SaslPassword = _options.SaslPassword;
            }

            using var consumer = new ConsumerBuilder<string, string>(config).Build();
            consumer.Subscribe(_topic);

            _logger.LogInformation("Started Kafka consumer background service on topic {Topic} with GroupId {GroupId}", _topic, _groupId);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var result = consumer.Consume(stoppingToken);
                    if (result?.Message == null) continue;

                    _logger.LogInformation("Received Kafka message on topic {Topic}: {Message}", _topic, result.Message.Value);

                    var integrationEvent = JsonSerializer.Deserialize<TEvent>(result.Message.Value);
                    if (integrationEvent != null)
                    {
                        using var scope = _serviceProvider.CreateScope();
                        var handler = scope.ServiceProvider.GetRequiredService<THandler>();
                        await handler.HandleAsync(integrationEvent, stoppingToken);
                    }

                    consumer.Commit(result);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing Kafka message on topic {Topic}", _topic);
                    // Depending on policy, wait before retrying to prevent hot loop
                    await Task.Delay(1000, stoppingToken);
                }
            }

            consumer.Close();
        }, stoppingToken);

        return Task.CompletedTask;
    }
}
