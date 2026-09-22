namespace MangaScrapper.Core.RateLimiting;

/// <summary>
/// Configuration options for MangaScrapper rate limiting policies.
/// </summary>
public sealed class RateLimitingOptions
{
    public const string SectionName = "RateLimiting";

    /// <summary>Whether rate limiting is globally enabled.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Global sliding window limiter across all requests.</summary>
    public PolicyOptions Global { get; set; } = new() { PermitLimit = 300, WindowSeconds = 60, SegmentsPerWindow = 4 };

    /// <summary>Default rate limit for general read endpoints.</summary>
    public PolicyOptions Default { get; set; } = new() { PermitLimit = 120, WindowSeconds = 60, SegmentsPerWindow = 4 };

    /// <summary>Rate limit for chapter view increment operations.</summary>
    public PolicyOptions MangaView { get; set; } = new() { PermitLimit = 30, WindowSeconds = 60, SegmentsPerWindow = 4 };

    /// <summary>Rate limit for ONNX embedding semantic search.</summary>
    public PolicyOptions SemanticSearch { get; set; } = new() { PermitLimit = 15, WindowSeconds = 60, SegmentsPerWindow = 4 };

    /// <summary>Rate limit for vector similarity search and recommendations.</summary>
    public PolicyOptions VectorSearch { get; set; } = new() { PermitLimit = 30, WindowSeconds = 60, SegmentsPerWindow = 4 };

    /// <summary>Rate limit for authentication endpoints (login, register, firebase).</summary>
    public PolicyOptions Auth { get; set; } = new() { PermitLimit = 10, WindowSeconds = 60, SegmentsPerWindow = 4 };

    /// <summary>Rate limit for scrapers and provider scrapers.</summary>
    public PolicyOptions Scraping { get; set; } = new() { PermitLimit = 20, WindowSeconds = 60, SegmentsPerWindow = 4 };

    /// <summary>Rate limit for proxying images.</summary>
    public PolicyOptions ImageProxy { get; set; } = new() { PermitLimit = 100, WindowSeconds = 60, SegmentsPerWindow = 4 };
}

public sealed class PolicyOptions
{
    /// <summary>Maximum number of permitted requests in the time window.</summary>
    public int PermitLimit { get; set; } = 60;

    /// <summary>Time window size in seconds.</summary>
    public int WindowSeconds { get; set; } = 60;

    /// <summary>Number of segments in sliding window.</summary>
    public int SegmentsPerWindow { get; set; } = 4;

    /// <summary>Maximum queued requests (0 = reject immediately when limit is reached).</summary>
    public int QueueLimit { get; set; } = 0;
}
