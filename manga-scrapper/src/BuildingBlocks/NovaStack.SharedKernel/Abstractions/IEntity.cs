namespace NovaStack.SharedKernel.Abstractions;

/// <summary>Marker interface for all entities.</summary>
public interface IEntity
{
    object Id { get; }
}

/// <summary>Strongly-typed entity interface.</summary>
public interface IEntity<TId> : IEntity
{
    new TId Id { get; }
}
