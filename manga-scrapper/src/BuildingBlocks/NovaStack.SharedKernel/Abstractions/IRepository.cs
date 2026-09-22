using NovaStack.SharedKernel.Results;

namespace NovaStack.SharedKernel.Abstractions;

/// <summary>Generic repository abstraction.</summary>
public interface IRepository<TEntity, TId>
    where TEntity : IAggregateRoot<TId>
{
    Task<TEntity?> GetByIdAsync(TId id, CancellationToken ct = default);
    Task<IEnumerable<TEntity>> GetAllAsync(CancellationToken ct = default);
    Task AddAsync(TEntity entity, CancellationToken ct = default);
    Task UpdateAsync(TEntity entity, CancellationToken ct = default);
    Task DeleteAsync(TEntity entity, CancellationToken ct = default);
    Task<bool> ExistsAsync(TId id, CancellationToken ct = default);
}
