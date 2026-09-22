namespace NovaStack.Infrastructure.Caching;

/// <summary>Cache configuration options.</summary>
public sealed class CacheOptions
{
    public const string SectionName = "Cache";

    public CacheProvider Provider { get; set; } = CacheProvider.InMemory;
    public string? RedisConnectionString { get; set; }
    public int DefaultExpiryMinutes { get; set; } = 15;
    public string? InstanceName { get; set; } = "novastack:";
}

public enum CacheProvider
{
    InMemory,
    Redis
}
