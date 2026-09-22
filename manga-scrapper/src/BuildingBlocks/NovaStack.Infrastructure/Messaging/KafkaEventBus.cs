using System.Text.Json;
using Confluent.Kafka;
using Microsoft.Extensions.Options;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging.Options;

namespace NovaStack.Infrastructure.Messaging;

/// <summary>
/// A lightweight, custom implementation of <see cref="IEventBus"/> using the native <see cref="Confluent.Kafka"/> producer.
/// </summary>
public sealed class KafkaEventBus : IEventBus, IDisposable
{
    private readonly KafkaOptions _options;
    private IProducer<string, string>? _producer;
    private readonly object _lock = new();

    public KafkaEventBus(IOptions<MessagingOptions> options)
    {
        _options = options.Value.Kafka;
    }

    private void EnsureProducer()
    {
        if (_producer is not null) return;

        lock (_lock)
        {
            if (_producer is not null) return;

            var config = new ProducerConfig
            {
                BootstrapServers = _options.BootstrapServers,
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

            _producer = new ProducerBuilder<string, string>(config).Build();
        }
    }

    public Task PublishAsync<T>(T integrationEvent, CancellationToken ct = default) 
        where T : class, IIntegrationEvent
    {
        return PublishAsync(integrationEvent, null, ct);
    }

    public async Task PublishAsync<T>(T integrationEvent, string? topicOrExchange, CancellationToken ct = default) 
        where T : class, IIntegrationEvent
    {
        EnsureProducer();

        var topic = topicOrExchange ?? typeof(T).Name;
        var messageValue = JsonSerializer.Serialize(integrationEvent);

        var message = new Message<string, string>
        {
            Key = Guid.CreateVersion7().ToString(),
            Value = messageValue
        };

        await _producer!.ProduceAsync(topic, message, ct);
    }

    public void Dispose()
    {
        _producer?.Dispose();
    }
}
