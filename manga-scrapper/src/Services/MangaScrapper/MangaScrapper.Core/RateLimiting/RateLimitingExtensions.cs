using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NovaStack.Contracts.Responses;
using NovaStack.Infrastructure.Http;
using Serilog;

namespace MangaScrapper.Core.RateLimiting;

public static class RateLimitingExtensions
{
    public static IServiceCollection AddMangaScrapperRateLimiting(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var rateLimitingOptions = configuration
            .GetSection(RateLimitingOptions.SectionName)
            .Get<RateLimitingOptions>() ?? new RateLimitingOptions();

        services.Configure<RateLimitingOptions>(configuration.GetSection(RateLimitingOptions.SectionName));

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            options.OnRejected = async (context, cancellationToken) =>
            {
                context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                context.HttpContext.Response.ContentType = "application/json";

                var retryAfterSeconds = "60";
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                {
                    retryAfterSeconds = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
                }

                context.HttpContext.Response.Headers.RetryAfter = retryAfterSeconds;

                var clientIp = context.HttpContext.GetClientIpAddress() ?? "unknown";
                var endpoint = context.HttpContext.GetEndpoint()?.DisplayName ?? context.HttpContext.Request.Path.Value;

                Log.Warning("Rate limit exceeded for client {ClientIp} requesting {Endpoint}. Retry after {RetryAfter}s",
                    clientIp, endpoint, retryAfterSeconds);

                var response = ApiResponse.Fail("Too many requests. Please slow down and try again later.", new[]
                {
                    $"Rate limit exceeded. Try again in {retryAfterSeconds} seconds."
                });

                await context.HttpContext.Response.WriteAsJsonAsync(response, cancellationToken);
            };

            // Global Limiter across the whole API (protects against raw flooding)
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
            {
                if (!rateLimitingOptions.Enabled)
                {
                    return RateLimitPartition.GetNoLimiter("Disabled");
                }

                var path = httpContext.Request.Path.Value ?? string.Empty;
                if (path.StartsWith("/health", StringComparison.OrdinalIgnoreCase) ||
                    path.StartsWith("/metrics", StringComparison.OrdinalIgnoreCase) ||
                    path.StartsWith("/openapi", StringComparison.OrdinalIgnoreCase) ||
                    path.StartsWith("/scalar", StringComparison.OrdinalIgnoreCase) ||
                    path.StartsWith("/_framework", StringComparison.OrdinalIgnoreCase) ||
                    path.StartsWith("/_content", StringComparison.OrdinalIgnoreCase) ||
                    path.StartsWith("/hangfire", StringComparison.OrdinalIgnoreCase) ||
                    path.StartsWith("/hubs", StringComparison.OrdinalIgnoreCase) ||
                    path.StartsWith("/manga-hub", StringComparison.OrdinalIgnoreCase) ||
                    path.StartsWith("/api/v1/scrapper/processes", StringComparison.OrdinalIgnoreCase))
                {
                    return RateLimitPartition.GetNoLimiter("Bypass");
                }

                return RateLimitPartition.GetSlidingWindowLimiter(
                    GetPartitionKey(httpContext),
                    _ => new SlidingWindowRateLimiterOptions
                    {
                        PermitLimit = rateLimitingOptions.Global.PermitLimit,
                        Window = TimeSpan.FromSeconds(rateLimitingOptions.Global.WindowSeconds),
                        SegmentsPerWindow = rateLimitingOptions.Global.SegmentsPerWindow,
                        QueueLimit = rateLimitingOptions.Global.QueueLimit,
                        AutoReplenishment = true
                    });
            });

            // Specific named policies
            AddSlidingPolicy(options, RateLimitPolicies.Default, rateLimitingOptions.Default, rateLimitingOptions.Enabled);
            AddSlidingPolicy(options, RateLimitPolicies.MangaView, rateLimitingOptions.MangaView, rateLimitingOptions.Enabled);
            AddSlidingPolicy(options, RateLimitPolicies.SemanticSearch, rateLimitingOptions.SemanticSearch, rateLimitingOptions.Enabled);
            AddSlidingPolicy(options, RateLimitPolicies.VectorSearch, rateLimitingOptions.VectorSearch, rateLimitingOptions.Enabled);
            AddSlidingPolicy(options, RateLimitPolicies.Auth, rateLimitingOptions.Auth, rateLimitingOptions.Enabled);
            AddSlidingPolicy(options, RateLimitPolicies.Scraping, rateLimitingOptions.Scraping, rateLimitingOptions.Enabled);
            AddSlidingPolicy(options, RateLimitPolicies.ImageProxy, rateLimitingOptions.ImageProxy, rateLimitingOptions.Enabled);
        });

        return services;
    }

    private static void AddSlidingPolicy(
        RateLimiterOptions options,
        string policyName,
        PolicyOptions policyOpts,
        bool enabled)
    {
        options.AddPolicy(policyName, httpContext =>
        {
            if (!enabled)
            {
                return RateLimitPartition.GetNoLimiter("Disabled");
            }

            return RateLimitPartition.GetSlidingWindowLimiter(
                $"{policyName}:{GetPartitionKey(httpContext)}",
                _ => new SlidingWindowRateLimiterOptions
                {
                    PermitLimit = policyOpts.PermitLimit,
                    Window = TimeSpan.FromSeconds(policyOpts.WindowSeconds),
                    SegmentsPerWindow = policyOpts.SegmentsPerWindow,
                    QueueLimit = policyOpts.QueueLimit,
                    AutoReplenishment = true
                });
        });
    }

    public static string GetPartitionKey(HttpContext httpContext)
    {
        var userId = httpContext.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrWhiteSpace(userId))
        {
            return $"usr:{userId}";
        }

        var clientIp = httpContext.GetClientIpAddress();
        if (!string.IsNullOrWhiteSpace(clientIp))
        {
            return $"ip:{clientIp}";
        }

        return "anon:unknown";
    }
}
