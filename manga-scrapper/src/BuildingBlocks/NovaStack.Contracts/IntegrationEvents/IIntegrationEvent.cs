namespace NovaStack.Contracts.IntegrationEvents;

/// <summary>Marker interface for all integration events published across service boundaries.</summary>
public interface IIntegrationEvent
{
    Guid EventId { get; }
    DateTime OccurredOn { get; }
    string EventType { get; }
}
