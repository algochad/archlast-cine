namespace NovaStack.SharedKernel.Abstractions;

/// <summary>Marker interface for aggregate roots.</summary>
public interface IAggregateRoot<TId> : IEntity<TId>
{
    IReadOnlyCollection<IDomainEvent> DomainEvents { get; }
    void ClearDomainEvents();
}
