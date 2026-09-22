namespace NovaStack.Infrastructure.Caching;

/// <summary>Caching service abstraction supporting both in-memory and distributed (Redis) caches.</summary>
public interface ICacheService
{
    Task<T?> GetAsync<T>(string key, CancellationToken ct = default)
        where T : class;

    Task SetAsync<T>(string key, T value, TimeSpan? expiry = null, CancellationToken ct = default)
        where T : class;

    Task RemoveAsync(string key, CancellationToken ct = default);

    Task<T> GetOrSetAsync<T>(
        string key,
        Func<CancellationToken, Task<T>> factory,
        TimeSpan? expiry = null,
        CancellationToken ct = default)
        where T : class;

    Task RemoveByPrefixAsync(string prefix, CancellationToken ct = default);
}
