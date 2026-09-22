using System.Net;

namespace NovaStack.Infrastructure.Http;

public static class HttpConfig
{
    public static void ConfigureClient(this HttpClient client)
    {
        client.Timeout = TimeSpan.FromMinutes(5);

        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36");

        client.DefaultRequestHeaders.TryAddWithoutValidation("Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8");

        client.DefaultRequestHeaders.TryAddWithoutValidation("Accept-Language",
            "en-US,en;q=0.9");
    }

    public static HttpClientHandler CreateHandler()
    {
        return new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            UseCookies = true,
            CookieContainer = new CookieContainer(),
            MaxConnectionsPerServer = 20
        };
    }
}
