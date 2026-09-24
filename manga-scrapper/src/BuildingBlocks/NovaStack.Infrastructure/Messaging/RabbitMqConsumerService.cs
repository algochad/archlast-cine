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
        var factory = new ConnectionFactory
        {
            HostName = _options.Host,
            Port = _options.Port,
            VirtualHost = _options.VirtualHost,
            UserName = _options.Username,
            Password = _options.Password,
            AutomaticRecoveryEnabled = true,
            NetworkRecoveryInterval = TimeSpan.FromSeconds(10),
        };

        // The broker is often not accepting connections yet when the worker
        // starts (cold start / broker restart). A single failed attempt used
        // to kill this consumer for the lifetime of the process, so retry
        // with backoff until shutdown is requested.
        var attempt = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
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

                var channel = _channel;
                var consumer = new AsyncEventingBasicConsumer(channel);
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

                        await channel.BasicAckAsync(args.DeliveryTag, false, stoppingToken);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error processing RabbitMQ message on queue {Queue}", _queueName);
                        // Nack and requeue
                        await channel.BasicNackAsync(args.DeliveryTag, false, requeue: true, cancellationToken: stoppingToken);
                    }
                };

                await _channel.BasicConsumeAsync(
                    queue: _queueName,
                    autoAck: false,
                    consumer: consumer,
                    cancellationToken: stoppingToken);

                _logger.LogInformation("Started RabbitMQ consumer background service on queue {Queue}", _queueName);

                // Stay alive until shutdown; AutomaticRecoveryEnabled lets the
                // client re-establish the connection after later broker drops.
                await Task.Delay(Timeout.Infinite, stoppingToken);
                return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                attempt++;
                _logger.LogWarning(ex, "RabbitMQ consumer for queue {Queue} failed (attempt {Attempt}); retrying in 5s", _queueName, attempt);
                DisposeConnection();
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }
            }
        }
    }

    public override void Dispose()
    {
        DisposeConnection();
        base.Dispose();
    }

    private void DisposeConnection()
    {
        _channel?.Dispose();
        _channel = null;
        _connection?.Dispose();
        _connection = null;
    }
}

