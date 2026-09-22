using NovaStack.Contracts.IntegrationEvents;

namespace NovaStack.Infrastructure.Messaging;

/// <summary>Handles a specific integration event type.</summary>
public interface IIntegrationEventHandler<in TEvent>
    where TEvent : class, IIntegrationEvent
{
    Task HandleAsync(TEvent integrationEvent, CancellationToken ct = default);
}
