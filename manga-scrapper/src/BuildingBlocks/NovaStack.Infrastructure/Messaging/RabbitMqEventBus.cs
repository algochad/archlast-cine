using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging.Options;
using RabbitMQ.Client;

namespace NovaStack.Infrastructure.Messaging;

/// <summary>
/// A lightweight, custom implementation of <see cref="IEventBus"/> using the native <see cref="RabbitMQ.Client"/>.
/// </summary>
public sealed class RabbitMqEventBus : IEventBus, IDisposable
{
    private readonly RabbitMqOptions _options;
    private IConnection? _connection;
    private IChannel? _channel;
    private readonly SemaphoreSlim _semaphore = new(1, 1);

    public RabbitMqEventBus(IOptions<MessagingOptions> options)
    {
        _options = options.Value.RabbitMQ;
    }

    private async Task EnsureConnectionAndChannelAsync(CancellationToken ct = default)
    {
        if (_channel is { IsOpen: true }) return;

        await _semaphore.WaitAsync(ct);
        try
        {
            if (_channel is { IsOpen: true }) return;

            var factory = new ConnectionFactory
            {
                HostName = _options.Host,
                Port = _options.Port,
                VirtualHost = _options.VirtualHost,
                UserName = _options.Username,
                Password = _options.Password
            };

            _connection = await factory.CreateConnectionAsync(ct);
            _channel = await _connection.CreateChannelAsync(cancellationToken: ct);
        }
        finally
        {
            _semaphore.Release();
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
        await EnsureConnectionAndChannelAsync(ct);

        var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(integrationEvent));

        // Use event name (e.g. "ProductCreatedIntegrationEvent") as queue/routing key name if none specified
        var targetName = topicOrExchange ?? typeof(T).Name;

        // Declare queue first to ensure it exists if there's no exchange setup yet
        await _channel!.QueueDeclareAsync(
            queue: targetName,
            durable: true,
            exclusive: false,
            autoDelete: false,
            arguments: null,
            cancellationToken: ct);

        var properties = new BasicProperties
        {
            Persistent = true
        };

        await _channel.BasicPublishAsync(
            exchange: string.Empty,
            routingKey: targetName,
            mandatory: false,
            basicProperties: properties,
            body: body,
            cancellationToken: ct);
    }

    public void Dispose()
    {
        _channel?.Dispose();
        _connection?.Dispose();
        _semaphore.Dispose();
    }
}

