namespace MangaScrapper.Core.RateLimiting;

/// <summary>
/// Defines policy names for API rate limiting across the MangaScrapper application.
/// </summary>
public static class RateLimitPolicies
{
    /// <summary>General default rate limit applied to standard API query endpoints.</summary>
    public const string Default = "Default";

    /// <summary>Rate limit for chapter view increment endpoints to prevent view-count spamming/manipulation.</summary>
    public const string MangaView = "MangaView";

    /// <summary>Rate limit for AI/multilingual ONNX vector embedding semantic search.</summary>
    public const string SemanticSearch = "SemanticSearch";

    /// <summary>Rate limit for vector similarity searches and recommendation queries (Qdrant).</summary>
    public const string VectorSearch = "VectorSearch";

    /// <summary>Rate limit for authentication endpoints to protect against brute-force attacks.</summary>
    public const string Auth = "Auth";

    /// <summary>Rate limit for scraper operations and provider scrapers to prevent downstream source bans and queue flooding.</summary>
    public const string Scraping = "Scraping";

    /// <summary>Rate limit for image proxying requests to protect server bandwidth.</summary>
    public const string ImageProxy = "ImageProxy";
}
