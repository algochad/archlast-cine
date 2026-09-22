using System.Text.Json.Serialization;

namespace MangaScrapper.Core.Services;

public class FlareSolverrService
{
    private readonly HttpClient _httpClient;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly bool _enabled;

    // Cached solved sessions: host -> (userAgent, cookies)
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (string UserAgent, List<FlareSolverrCookie> Cookies)> _sessionCache = new();

    // Per-host lock to prevent concurrent challenge-solve requests
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, SemaphoreSlim> _hostLocks = new();

    private static SemaphoreSlim GetHostLock(string host)
        => _hostLocks.GetOrAdd(host, _ => new SemaphoreSlim(1, 1));

    public FlareSolverrService(HttpClient httpClient, IHttpClientFactory httpClientFactory, bool enabled)
    {
        _httpClient = httpClient;
        _httpClientFactory = httpClientFactory;
        _enabled = enabled;
    }

    public bool IsEnabled => _enabled;

    public bool TryGetSession(string host, out string userAgent, out string cookieHeader)
    {
        userAgent = string.Empty;
        cookieHeader = string.Empty;
        if (_sessionCache.TryGetValue(host, out var session))
        {
            userAgent = session.UserAgent;
            cookieHeader = string.Join("; ", session.Cookies.Select(c => $"{c.Name}={c.Value}"));
            return true;
        }
        return false;
    }

    /// <summary>
    /// Ensures a valid session exists for the given host, solving the Cloudflare challenge if needed.
    /// Concurrent calls for the same host are coalesced — only one actual FlareSolverr request is made.
    /// </summary>
    public async Task EnsureSessionAsync(string url, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;
        var host = uri.Host;

        if (_sessionCache.ContainsKey(host)) return;

        var hostLock = GetHostLock(host);
        await hostLock.WaitAsync(ct);
        try
        {
            if (_sessionCache.ContainsKey(host)) return;
            await SendThroughFlareSolverr($"{uri.Scheme}://{host}", null, ct, host);
        }
        finally
        {
            hostLock.Release();
        }
    }

    public async Task<string> GetHtmlAsync(string url, HttpContent? content = default, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            throw new ArgumentException($"Invalid URL: {url}", nameof(url));

        var host = uri.Host;
        string? postData = null;
        string? mediaType = null;
        if (content != null)
        {
            postData = await content.ReadAsStringAsync(ct);
            mediaType = content.Headers.ContentType?.MediaType ?? "application/x-www-form-urlencoded";
        }

        if (_sessionCache.ContainsKey(host))
        {
            var hostLock = GetHostLock(host);
            await hostLock.WaitAsync(ct);
            try
            {
                if (TryGetSession(host, out var userAgent, out var cookieHeader))
                {
                    try
                    {
                        var client = _httpClientFactory.CreateClient();
                        using var request = new HttpRequestMessage(postData != null ? HttpMethod.Post : HttpMethod.Get, url);
                        if (postData != null)
                        {
                            request.Content = new StringContent(postData, System.Text.Encoding.UTF8, mediaType);
                        }
                        if (!string.IsNullOrEmpty(userAgent))
                        {
                            request.Headers.UserAgent.Clear();
                            request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
                        }
                        if (!string.IsNullOrEmpty(cookieHeader))
                        {
                            request.Headers.TryAddWithoutValidation("Cookie", cookieHeader);
                        }

                        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
                        if (response.IsSuccessStatusCode)
                        {
                            var encoding = response.Content.Headers.ContentEncoding.FirstOrDefault()?.ToLowerInvariant();
                            await using var rawStream = await response.Content.ReadAsStreamAsync(ct);
                            Stream decompressedStream = encoding switch
                            {
                                "gzip"    => new System.IO.Compression.GZipStream(rawStream, System.IO.Compression.CompressionMode.Decompress),
                                "deflate" => new System.IO.Compression.DeflateStream(rawStream, System.IO.Compression.CompressionMode.Decompress),
                                "br"      => new System.IO.Compression.BrotliStream(rawStream, System.IO.Compression.CompressionMode.Decompress),
                                _         => rawStream
                            };
                            await using (decompressedStream)
                            using (var reader = new StreamReader(decompressedStream, System.Text.Encoding.UTF8))
                            {
                                return await reader.ReadToEndAsync(ct);
                            }
                        }
                    }
                    catch
                    {
                        // Ignore and fall back to FlareSolverr
                    }

                    _sessionCache.TryRemove(host, out _);
                }

                return await SendThroughFlareSolverr(url, postData, ct, host);
            }
            finally
            {
                hostLock.Release();
            }
        }

        var lockSlim = GetHostLock(host);
        await lockSlim.WaitAsync(ct);
        try
        {
            return await SendThroughFlareSolverr(url, postData, ct, host);
        }
        finally
        {
            lockSlim.Release();
        }
    }

    private async Task<string> SendThroughFlareSolverr(string url, string? postData, CancellationToken ct, string host)
    {
        var requestBody = new FlareSolverrRequest { Url = url, MaxTimeout = 60000 };

        if (postData != null)
        {
            requestBody.Cmd = "request.post";
            requestBody.PostData = postData;
        }
        else
        {
            requestBody.Cmd = "request.get";
        }

        var response = await _httpClient.PostAsJsonAsync("/v1", requestBody, ct);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<FlareSolverrResponse>(cancellationToken: ct);
        if (result == null || result.Status != "ok" || result.Solution == null)
        {
            throw new HttpRequestException($"FlareSolverr request failed: {result?.Message ?? "Unknown error"}");
        }

        if (result.Solution.Cookies != null)
        {
            _sessionCache[host] = (result.Solution.UserAgent, result.Solution.Cookies);
        }

        return result.Solution.Response;
    }
}

public class FlareSolverrRequest
{
    [JsonPropertyName("cmd")]
    public string Cmd { get; set; } = "request.get";

    [JsonPropertyName("url")]
    public string Url { get; set; } = string.Empty;

    [JsonPropertyName("postData")]
    public string? PostData { get; set; }

    [JsonPropertyName("maxTimeout")]
    public int MaxTimeout { get; set; } = 60000;
}

public class FlareSolverrResponse
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    [JsonPropertyName("solution")]
    public FlareSolverrSolution? Solution { get; set; }
}

public class FlareSolverrSolution
{
    [JsonPropertyName("url")]
    public string Url { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public int Status { get; set; }

    [JsonPropertyName("response")]
    public string Response { get; set; } = string.Empty;

    [JsonPropertyName("cookies")]
    public List<FlareSolverrCookie>? Cookies { get; set; }

    [JsonPropertyName("userAgent")]
    public string UserAgent { get; set; } = string.Empty;
}

public class FlareSolverrCookie
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("value")]
    public string Value { get; set; } = string.Empty;
}
