using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;

namespace NovaStack.Infrastructure.Caching;

/// <summary>Redis-backed distributed cache implementation.</summary>
internal sealed class RedisCacheService : ICacheService
{
    private readonly IDistributedCache _cache;
    private readonly CacheOptions _options;

    public RedisCacheService(IDistributedCache cache, CacheOptions options)
    {
        _cache = cache;
        _options = options;
    }

    public async Task<T?> GetAsync<T>(string key, CancellationToken ct = default) where T : class
    {
        var json = await _cache.GetStringAsync(key, ct);
        return json is null ? null : JsonSerializer.Deserialize<T>(json);
    }

    public async Task SetAsync<T>(string key, T value, TimeSpan? expiry = null, CancellationToken ct = default)
        where T : class
    {
        var json = JsonSerializer.Serialize(value);
        var options = new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = expiry ?? TimeSpan.FromMinutes(_options.DefaultExpiryMinutes)
        };
        await _cache.SetStringAsync(key, json, options, ct);
    }

    public async Task RemoveAsync(string key, CancellationToken ct = default) =>
        await _cache.RemoveAsync(key, ct);

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

    public async Task RemoveByPrefixAsync(string prefix, CancellationToken ct = default)
    {
        // Note: Pattern-based deletion requires StackExchange.Redis directly.
        // Implement via IConnectionMultiplexer if needed.
        await Task.CompletedTask;
    }
}
