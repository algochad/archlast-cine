using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging.Options;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace NovaStack.Infrastructure.Messaging;

/// <summary>
/// A native RabbitMQ background consumer service that listens to a specific queue
/// and processes events using an injected <see cref="IIntegrationEventHandler{TEvent}"/>.
/// </summary>
public sealed class RabbitMqConsumerService<TEvent, THandler> : BackgroundService
    where TEvent : class, IIntegrationEvent
    where THandler : class, IIntegrationEventHandler<TEvent>
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<RabbitMqConsumerService<TEvent, THandler>> _logger;
    private readonly RabbitMqOptions _options;
    private readonly string _queueName;
    private IConnection? _connection;
    private IChannel? _channel;

    public RabbitMqConsumerService(
        IServiceProvider serviceProvider,
        ILogger<RabbitMqConsumerService<TEvent, THandler>> logger,
        RabbitMqOptions options,
        string queueName)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _options = options;
        _queueName = queueName;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            var factory = new ConnectionFactory
            {
                HostName = _options.Host,
                Port = _options.Port,
                VirtualHost = _options.VirtualHost,
                UserName = _options.Username,
                Password = _options.Password
            };

            _connection = await factory.CreateConnectionAsync(stoppingToken);
            _channel = await _connection.CreateChannelAsync(cancellationToken: stoppingToken);

            await _channel.QueueDeclareAsync(
                queue: _queueName,
                durable: true,
                exclusive: false,
                autoDelete: false,
                arguments: null,
                cancellationToken: stoppingToken);

            await _channel.BasicQosAsync(0, _options.PrefetchCount, false, stoppingToken);

            var consumer = new AsyncEventingBasicConsumer(_channel);
            consumer.ReceivedAsync += async (sender, args) =>
            {
                var bodyBytes = args.Body.ToArray();
                var bodyText = Encoding.UTF8.GetString(bodyBytes);

                _logger.LogInformation("Received RabbitMQ message on queue {Queue}: {Message}", _queueName, bodyText);

                try
                {
                    var integrationEvent = JsonSerializer.Deserialize<TEvent>(bodyText);
                    if (integrationEvent != null)
                    {
                        using var scope = _serviceProvider.CreateScope();
                        var handler = scope.ServiceProvider.GetRequiredService<THandler>();
                        await handler.HandleAsync(integrationEvent, stoppingToken);
                    }

                    await _channel.BasicAckAsync(args.DeliveryTag, false, stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing RabbitMQ message on queue {Queue}", _queueName);
                    // Nack and requeue
                    await _channel.BasicNackAsync(args.DeliveryTag, false, requeue: true, cancellationToken: stoppingToken);
                }
            };

            await _channel.BasicConsumeAsync(
                queue: _queueName,
                autoAck: false,
                consumer: consumer,
                cancellationToken: stoppingToken);

            _logger.LogInformation("Started RabbitMQ consumer background service on queue {Queue}", _queueName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start RabbitMQ consumer service on queue {Queue}", _queueName);
        }
    }

    public override void Dispose()
    {
        _channel?.Dispose();
        _connection?.Dispose();
        base.Dispose();
    }
}

