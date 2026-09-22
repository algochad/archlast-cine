namespace NovaStack.SharedKernel.Abstractions;

/// <summary>
/// Non-generic interface for accessing domain events from any entity,
/// avoiding the problematic covariant/contravariant cast issues with IAggregateRoot&lt;TId&gt;.
/// Implemented automatically by <see cref="NovaStack.SharedKernel.Common.Entity{TId}"/>.
/// </summary>
public interface IHasDomainEvents
{
    IReadOnlyCollection<IDomainEvent> GetDomainEvents();
    void ClearDomainEvents();
}
