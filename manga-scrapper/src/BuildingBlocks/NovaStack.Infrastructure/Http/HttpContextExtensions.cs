using Microsoft.AspNetCore.Http;

namespace NovaStack.Infrastructure.Http;

public static class HttpContextExtensions
{
    /// <summary>
    /// Extracts the real client IP address even when the application is running behind reverse proxies
    /// (such as Cloudflare, Nginx, Traefik, AWS ALB, Caddy, etc.).
    /// </summary>
    public static string? GetClientIpAddress(this HttpContext? context)
    {
        if (context == null) return null;

        // 1. Cloudflare header
        if (context.Request.Headers.TryGetValue("CF-Connecting-IP", out var cfIp) && !string.IsNullOrWhiteSpace(cfIp))
        {
            return cfIp.ToString().Split(',')[0].Trim();
        }

        // 2. Standard X-Real-IP header (common in Nginx)
        if (context.Request.Headers.TryGetValue("X-Real-IP", out var realIp) && !string.IsNullOrWhiteSpace(realIp))
        {
            return realIp.ToString().Split(',')[0].Trim();
        }

        // 3. X-Forwarded-For header (comma-separated list of IPs: client, proxy1, proxy2)
        if (context.Request.Headers.TryGetValue("X-Forwarded-For", out var forwardedFor) && !string.IsNullOrWhiteSpace(forwardedFor))
        {
            var firstIp = forwardedFor.ToString().Split(',')[0].Trim();
            if (!string.IsNullOrWhiteSpace(firstIp))
            {
                return firstIp;
            }
        }

        // 4. Fallback to Connection.RemoteIpAddress (also populated when UseForwardedHeaders is active)
        return context.Connection.RemoteIpAddress?.ToString();
    }
}
