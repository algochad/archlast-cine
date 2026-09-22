using NovaStack.Contracts.IntegrationEvents;

namespace NovaStack.Infrastructure.Messaging;

/// <summary>Abstraction for publishing integration events to a message broker.</summary>
public interface IEventBus
{
    Task PublishAsync<T>(T integrationEvent, CancellationToken ct = default)
        where T : class, IIntegrationEvent;

    Task PublishAsync<T>(T integrationEvent, string? topicOrExchange, CancellationToken ct = default)
        where T : class, IIntegrationEvent;
}
