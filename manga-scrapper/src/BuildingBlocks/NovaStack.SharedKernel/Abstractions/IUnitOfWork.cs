namespace NovaStack.SharedKernel.Abstractions;

/// <summary>Unit of Work abstraction for committing changes atomically.</summary>
public interface IUnitOfWork
{
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}
