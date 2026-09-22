using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Messaging;
using NovaStack.Infrastructure.Messaging.Options;

namespace NovaStack.Infrastructure.DependencyInjection;

/// <summary>
/// Extension methods for registering custom native client-based event bus
/// and consumer background services for RabbitMQ and Kafka.
/// </summary>
public static class NativeMessagingExtensions
{
    public static IServiceCollection AddNativeRabbitMqEventBus(this IServiceCollection services)
    {
        services.AddSingleton<IEventBus, RabbitMqEventBus>();
        return services;
    }

    public static IServiceCollection AddNativeKafkaEventBus(this IServiceCollection services)
    {
        services.AddSingleton<IEventBus, KafkaEventBus>();
        return services;
    }

    public static IServiceCollection AddRabbitMqConsumer<TEvent, THandler>(
        this IServiceCollection services, 
        string queueName)
        where TEvent : class, IIntegrationEvent
        where THandler : class, IIntegrationEventHandler<TEvent>
    {
        services.AddScoped<THandler>();
        services.AddHostedService(sp => 
        {
            var options = sp.GetRequiredService<IOptions<MessagingOptions>>().Value.RabbitMQ;
            var logger = sp.GetRequiredService<ILogger<RabbitMqConsumerService<TEvent, THandler>>>();
            return new RabbitMqConsumerService<TEvent, THandler>(sp, logger, options, queueName);
        });
        return services;
    }

    public static IServiceCollection AddKafkaConsumer<TEvent, THandler>(
        this IServiceCollection services, 
        string topic, 
        string? groupId = null)
        where TEvent : class, IIntegrationEvent
        where THandler : class, IIntegrationEventHandler<TEvent>
    {
        services.AddScoped<THandler>();
        services.AddHostedService(sp => 
        {
            var options = sp.GetRequiredService<IOptions<MessagingOptions>>().Value.Kafka;
            var logger = sp.GetRequiredService<ILogger<KafkaConsumerService<TEvent, THandler>>>();
            return new KafkaConsumerService<TEvent, THandler>(sp, logger, options, topic, groupId);
        });
        return services;
    }
}
