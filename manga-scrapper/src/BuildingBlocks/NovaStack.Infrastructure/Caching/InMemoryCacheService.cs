using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace NovaStack.Infrastructure.Caching;

/// <summary>In-memory cache implementation using <see cref="IMemoryCache"/>.</summary>
internal sealed class InMemoryCacheService : ICacheService
{
    private readonly IMemoryCache _cache;
    private readonly CacheOptions _options;
    private readonly HashSet<string> _keys = [];
    private readonly object _lock = new();

    public InMemoryCacheService(IMemoryCache cache, CacheOptions options)
    {
        _cache = cache;
        _options = options;
    }

    public Task<T?> GetAsync<T>(string key, CancellationToken ct = default) where T : class
    {
        _cache.TryGetValue(key, out string? json);
        if (json is null) return Task.FromResult<T?>(null);
        return Task.FromResult(JsonSerializer.Deserialize<T>(json));
    }

    public Task SetAsync<T>(string key, T value, TimeSpan? expiry = null, CancellationToken ct = default)
        where T : class
    {
        var json = JsonSerializer.Serialize(value);
        var options = new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = expiry ?? TimeSpan.FromMinutes(_options.DefaultExpiryMinutes)
        };
        _cache.Set(key, json, options);
        lock (_lock) _keys.Add(key);
        return Task.CompletedTask;
    }

    public Task RemoveAsync(string key, CancellationToken ct = default)
    {
        _cache.Remove(key);
        lock (_lock) _keys.Remove(key);
        return Task.CompletedTask;
    }

    public async Task<T> GetOrSetAsync<T>(
        string key,
        Func<CancellationToken, Task<T>> factory,
        TimeSpan? expiry = null,
        CancellationToken ct = default)
        where T : class
    {
        var existing = await GetAsync<T>(key, ct);
        if (existing is not null) return existing;

        var value = await factory(ct);
        await SetAsync(key, value, expiry, ct);
        return value;
    }

    public Task RemoveByPrefixAsync(string prefix, CancellationToken ct = default)
    {
        List<string> keysToRemove;
        lock (_lock) keysToRemove = _keys.Where(k => k.StartsWith(prefix)).ToList();
        foreach (var key in keysToRemove)
        {
            _cache.Remove(key);
            lock (_lock) _keys.Remove(key);
        }
        return Task.CompletedTask;
    }
}
