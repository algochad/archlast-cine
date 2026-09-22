using NovaStack.SharedKernel.Abstractions;

namespace NovaStack.SharedKernel.Common;

/// <summary>
/// Base class for entities. Implements domain event collection, equality by Id,
/// and both IAggregateRoot (generic) and IHasDomainEvents (non-generic) for
/// compatible usage in infrastructure scanning.
/// </summary>
public abstract class Entity<TId> : IEntity<TId>, IAggregateRoot<TId>, IHasDomainEvents
    where TId : notnull
{
    private readonly List<IDomainEvent> _domainEvents = [];

    protected Entity(TId id) { Id = id; }

    /// <summary>Required by EF Core.</summary>
    protected Entity() { Id = default!; }

    public TId Id { get; protected set; }
    object IEntity.Id => Id;

    // ── IAggregateRoot<TId> ───────────────────────────────────────────────
    public IReadOnlyCollection<IDomainEvent> DomainEvents => _domainEvents.AsReadOnly();
    public void ClearDomainEvents() => _domainEvents.Clear();

    // ── IHasDomainEvents (non-generic accessor) ───────────────────────────
    IReadOnlyCollection<IDomainEvent> IHasDomainEvents.GetDomainEvents() => _domainEvents.AsReadOnly();
    void IHasDomainEvents.ClearDomainEvents() => _domainEvents.Clear();

    protected void RaiseDomainEvent(IDomainEvent domainEvent) =>
        _domainEvents.Add(domainEvent);

    // ── Equality ──────────────────────────────────────────────────────────
    public override bool Equals(object? obj)
    {
        if (obj is not Entity<TId> other) return false;
        if (ReferenceEquals(this, other)) return true;
        if (GetType() != other.GetType()) return false;
        return Id.Equals(other.Id);
    }

    public override int GetHashCode() => HashCode.Combine(GetType(), Id);

    public static bool operator ==(Entity<TId>? left, Entity<TId>? right) =>
        left?.Equals(right) ?? right is null;

    public static bool operator !=(Entity<TId>? left, Entity<TId>? right) =>
        !(left == right);
}
