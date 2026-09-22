namespace NovaStack.SharedKernel.Abstractions;

/// <summary>Marker interface for domain events.</summary>
public interface IDomainEvent
{
    Guid EventId { get; }
    DateTime OccurredOn { get; }
}
