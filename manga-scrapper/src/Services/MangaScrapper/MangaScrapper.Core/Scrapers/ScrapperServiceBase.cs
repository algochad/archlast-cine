using System.Globalization;
using System.Text.Json;
using System.Web;
using HtmlAgilityPack;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.Utils;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Contracts.Responses;
using NovaStack.Infrastructure.Messaging;
using SkiaSharp;

namespace MangaScrapper.Core.Scrapers;

public interface IScrapperService
{
    Task<HtmlDocument> GetHtml(string url, string? query = null, HttpContent? formData = null, CancellationToken ct = default);
    Task<(string path, long size, int width, int height, bool isFallback)> DownloadAndConvertToWebP(string mangaTitle, string chapterNumber, string imageUrl, int index, CancellationToken ct = default);
    Task<(string path, long size)> DownloadThumbnailAndConvertToWebP(string mangaTitle, string imageUrl, CancellationToken ct = default);
    string GetCleanTitle(string title);
    Task<Manga> UpdateMangaMetaData(Manga manga, CancellationToken ct = default);
    Task<Manga> ExtractManga(string url, CancellationToken ct, bool scrapChapters = true, string? linkedId = null);
    Task<Manga> GetDetail(string url, CancellationToken ct);
    Task<Chapter> GetChapterPage(string mangaTitle, Chapter chapter, CancellationToken ct = default, Func<int, int, Task>? onProgress = null);
    Task QueueChapterScraping(Guid mangaId, string mangaTitle, Chapter chapter, CancellationToken ct = default);
    Task<List<SearchItem>> SearchManga(SearchRequest request, CancellationToken ct);
    Task<List<Page>> GetAllPages(string url, CancellationToken ct = default);
    Task<List<ScrapperProvider>> GetAllProvider();
}

public abstract class ScrapperServiceBase : IScrapperService, IProviderScrapperService
{
    protected const string DefaultIndonesianLanguage = "id";

    protected readonly HttpClient HttpClient;
    protected readonly IEventBus EventBus;
    protected readonly IServiceScopeFactory ScopeFactory;
    protected readonly SemaphoreSlim Semaphore;
    protected readonly string ImageStoragePath;
    protected readonly MeilisearchService MeilisearchService;
    protected readonly QdrantService QdrantService;
    protected readonly ILogger Logger;
    protected readonly FlareSolverrService FlareSolverrService;

    /// <summary>Provider key used to resolve this scraper from the DI container (e.g. "komiku", "kiryuu").</summary>
    protected abstract string ProviderKey { get; }
    private ScrapperProvider? _provider;

    // Repository for domain aggregate access used by scrapers
    private readonly IMangaRepository _mangaRepo;

    private readonly ScrapperSettings _scrapperSettings;

    protected ScrapperServiceBase(
        HttpClient httpClient,
        IMangaRepository mangaRepo,
        IEventBus eventBus,
        IServiceScopeFactory scopeFactory,
        IOptions<ScrapperSettings> settings,
        SemaphoreSlim semaphore,
        MeilisearchService meilisearchService,
        QdrantService qdrantService,
        ILoggerFactory loggerFactory,
        FlareSolverrService flareSolverrService)
    {
        HttpClient = httpClient;
        _mangaRepo = mangaRepo;
        EventBus = eventBus;
        ScopeFactory = scopeFactory;
        Semaphore = semaphore;
        MeilisearchService = meilisearchService;
        QdrantService = qdrantService;
        Logger = loggerFactory.CreateLogger(GetType());
        FlareSolverrService = flareSolverrService;
        _scrapperSettings = settings.Value;
        var path = _scrapperSettings.ImageStoragePath;
        ImageStoragePath = Path.IsPathRooted(path) ? path : Path.Combine(Directory.GetCurrentDirectory(), path);
        Directory.CreateDirectory(ImageStoragePath);
    }

    protected ScrapperProvider Provider => _provider ?? throw new InvalidOperationException("Provider has not been loaded.");

    protected void LoadProvider(string providerName)
    {
        if (_provider != null) return;

        if (!string.IsNullOrWhiteSpace(_scrapperSettings.ApiBaseUrl))
        {
            var url = $"{_scrapperSettings.ApiBaseUrl.TrimEnd('/')}/api/v1/providers/{providerName}";
            try
            {
                var response = HttpClient.GetAsync(url).GetAwaiter().GetResult();
                if (response.IsSuccessStatusCode)
                {
                    var json = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    _provider = JsonSerializer.Deserialize<ScrapperProvider>(json);
                    return;
                }
                else
                {
                    Logger.LogWarning("Failed to fetch provider {ProviderName} from API ({StatusCode}). Falling back to local files.", providerName, response.StatusCode);
                }
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Exception fetching provider {ProviderName} from API. Falling back to local files.", providerName);
            }
        }

        var pathsToTry = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "provider", providerName),
            Path.Combine(Directory.GetCurrentDirectory(), "provider", providerName)
        };

        foreach (var path in pathsToTry)
        {
            if (File.Exists(path))
            {
                var json = File.ReadAllTextAsync(path).GetAwaiter().GetResult();
                _provider = JsonSerializer.Deserialize<ScrapperProvider>(json);
                return;
            }
        }

        throw new FileNotFoundException($"Provider file {providerName} could not be found via API or local disk.");
    }

    public async Task<HtmlDocument> GetHtml(string url, string? query = null, HttpContent? formData = null, CancellationToken ct = default)
    {
        byte[]? formBytes = null;
        string? mediaType = null;
        if (formData != null)
        {
            formBytes = await formData.ReadAsByteArrayAsync(ct);
            mediaType = formData.Headers.ContentType?.MediaType ?? "application/x-www-form-urlencoded";
        }

        return await ExecuteWithRetryAsync(async token =>
        {
            if (FlareSolverrService is { IsEnabled: true })
            {
                await FlareSolverrService.EnsureSessionAsync(url, token);
                HttpContent? content = formBytes != null
                    ? new ByteArrayContent(formBytes) { Headers = { ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(mediaType!) } }
                    : null;
                var html = await FlareSolverrService.GetHtmlAsync(url, content, token);
                var doc = new HtmlDocument();
                doc.LoadHtml(html);
                return doc;
            }

            if (formBytes != null)
            {
                using var content1 = new ByteArrayContent(formBytes) { Headers = { ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(mediaType!) } };
                var responseForm = await HttpClient.PostAsync(url, content1, token);
                if (responseForm.StatusCode is System.Net.HttpStatusCode.MovedPermanently or System.Net.HttpStatusCode.Found)
                {
                    var newUrl = responseForm.Headers.Location;
                    if (newUrl != null)
                    {
                        if (!newUrl.IsAbsoluteUri) newUrl = new Uri(new Uri(url), newUrl);
                        using var content2 = new ByteArrayContent(formBytes) { Headers = { ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(mediaType!) } };
                        responseForm = await HttpClient.PostAsync(newUrl, content2, token);
                    }
                }
                responseForm.EnsureSuccessStatusCode();
                var str1 = await responseForm.Content.ReadAsStringAsync(token);
                var doc1 = new HtmlDocument();
                doc1.LoadHtml(str1);
                return doc1;
            }

            var response = await HttpClient.GetAsync(url, token);
            response.EnsureSuccessStatusCode();
            var str = await DecompressResponseAsync(response, token);
            var doc2 = new HtmlDocument();
            doc2.LoadHtml(str);
            return doc2;
        }, ct);
    }

    /// <summary>
    /// Reads the HTTP response body and decompresses it when the server sends
    /// <c>Content-Encoding: gzip</c>, <c>deflate</c>, or <c>br</c> (Brotli).
    /// Falls back to <see cref="HttpContent.ReadAsStringAsync"/> when no compression is detected.
    /// </summary>
    private static async Task<string> DecompressResponseAsync(HttpResponseMessage response, CancellationToken ct)
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

    protected async Task<T?> GetFromJsonAsync<T>(string url, CancellationToken cancellationToken = default)
    {
        return await ExecuteWithRetryAsync<T?>(async token =>
        {
            // First attempt with direct HttpClient
            try
            {
                var response = await HttpClient.GetAsync(url, token);
                if (response.IsSuccessStatusCode)
                {
                    var text = await DecompressResponseAsync(response, token);
                    var trimmed = text.Trim();
                    if (trimmed.StartsWith('{') || trimmed.StartsWith('['))
                    {
                        return JsonSerializer.Deserialize<T>(trimmed, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    }
                }
                else if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                {
                    throw new HttpRequestException("Rate limited (429)", null, System.Net.HttpStatusCode.TooManyRequests);
                }
                else if ((int)response.StatusCode == 403 && FlareSolverrService is { IsEnabled: true })
                {
                    // Cloudflare block -> fall through to FlareSolverr
                }
                else
                {
                    response.EnsureSuccessStatusCode();
                }
            }
            catch (Exception ex) when (ex is not HttpRequestException { StatusCode: System.Net.HttpStatusCode.TooManyRequests } && FlareSolverrService is { IsEnabled: true })
            {
                // Fall back to FlareSolverr if direct HttpClient failed
            }

            if (FlareSolverrService is { IsEnabled: true })
            {
                var jsonText = await FlareSolverrService.GetHtmlAsync(url, ct: token);
                var trimmed = jsonText.Trim();
                if (trimmed.StartsWith('<'))
                {
                    var doc = new HtmlDocument();
                    doc.LoadHtml(jsonText);
                    var preNode = doc.DocumentNode.SelectSingleNode("//pre");
                    if (preNode != null)
                    {
                        trimmed = HtmlEntity.DeEntitize(preNode.InnerText).Trim();
                    }
                    else
                    {
                        var body = doc.DocumentNode.SelectSingleNode("//body")?.InnerText ?? doc.DocumentNode.InnerText;
                        trimmed = HtmlEntity.DeEntitize(body).Trim();
                    }
                }

                if (trimmed.StartsWith('{') || trimmed.StartsWith('['))
                {
                    return JsonSerializer.Deserialize<T>(trimmed, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                }

                throw new HttpRequestException($"Response from {url} is not valid JSON: {(trimmed.Length > 100 ? trimmed[..100] : trimmed)}");
            }

            throw new HttpRequestException($"Failed to retrieve valid JSON from {url}");
        }, cancellationToken);
    }

    protected async Task<T> ExecuteWithRetryAsync<T>(Func<CancellationToken, Task<T>> action, CancellationToken ct, int maxRetries = 3)
    {
        for (var i = 0; i < maxRetries; i++)
        {
            try { return await action(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Net.Sockets.SocketException)
            {
                if (i == maxRetries - 1) throw;

                var delay = 1000 * (i + 1);
                if (ex is HttpRequestException { StatusCode: System.Net.HttpStatusCode.TooManyRequests })
                {
                    delay = 5000 * (int)Math.Pow(2, i);
                    Logger.LogWarning("Rate limited (429). Retrying in {Delay}ms...", delay);
                }

                await Task.Delay(delay, ct);
            }
        }
        throw new Exception("Retry failed");
    }

    public async Task<(string path, long size, int width, int height, bool isFallback)> DownloadAndConvertToWebP(string mangaTitle, string chapterNumber, string imageUrl, int index, CancellationToken ct = default)
    {
        var cleanTitle = GetCleanTitle(mangaTitle);
        var subDir = Path.Combine(ImageStoragePath, cleanTitle, chapterNumber);
        var ext = IsAvifUrl(imageUrl) ? ".avif" : ".webp";
        var fileName = $"{index}{ext}";
        return await SaveImageAsync(imageUrl, subDir, fileName, $"{cleanTitle}/{chapterNumber}/{fileName}", ct);
    }

    public async Task<(string path, long size)> DownloadThumbnailAndConvertToWebP(string mangaTitle, string imageUrl, CancellationToken ct = default)
    {
        try
        {
            var cleanTitle = GetCleanTitle(mangaTitle);
            var subDir = Path.Combine(ImageStoragePath, cleanTitle);
            var ext = IsAvifUrl(imageUrl) ? ".avif" : ".webp";
            var result = await SaveImageAsync(imageUrl, subDir, $"thumbnail{ext}", $"{cleanTitle}/thumbnail{ext}", ct);
            return (result.path, result.size);
        }
        catch { return (string.Empty, 0); }
    }

    public string GetCleanTitle(string title)
    {
        var invalidChars = Path.GetInvalidFileNameChars().Union(new[] { '?', '*', ':', '|', '<', '>', '"' }).ToArray();
        var cleaned = string.Concat(title.Split(invalidChars)).TrimEnd('.', ' ');
        return string.IsNullOrEmpty(cleaned) ? "manga" : cleaned;
    }

    private static readonly Lazy<byte[]> FallbackBrokenImageBytes = new(() =>
    {
        const int w = 720;
        const int h = 1080;
        using var surface = SKSurface.Create(new SKImageInfo(w, h, SKColorType.Rgba8888, SKAlphaType.Premul));
        var canvas = surface.Canvas;

        // Background
        canvas.Clear(new SKColor(24, 24, 27)); // #18181b

        // Border / Card box
        using var boxPaint = new SKPaint
        {
            Color = new SKColor(39, 39, 42), // #27272a
            Style = SKPaintStyle.Fill,
            IsAntialias = true
        };
        var rrect = new SKRoundRect(new SKRect(60, 200, w - 60, h - 200), 24, 24);
        canvas.DrawRoundRect(rrect, boxPaint);

        using var borderPaint = new SKPaint
        {
            Color = new SKColor(63, 63, 70), // #3f3f46
            Style = SKPaintStyle.Stroke,
            StrokeWidth = 3,
            IsAntialias = true
        };
        canvas.DrawRoundRect(rrect, borderPaint);

        // Broken image icon (inner rectangle with broken line)
        using var iconPaint = new SKPaint
        {
            Color = new SKColor(113, 113, 122), // #71717a
            Style = SKPaintStyle.Stroke,
            StrokeWidth = 4,
            IsAntialias = true
        };
        var iconRect = new SKRect((w / 2f) - 60, (h / 2f) - 120, (w / 2f) + 60, (h / 2f) - 20);
        canvas.DrawRoundRect(new SKRoundRect(iconRect, 12, 12), iconPaint);
        canvas.DrawLine((w / 2f) - 30, (h / 2f) - 120, (w / 2f) + 10, (h / 2f) - 70, iconPaint);
        canvas.DrawLine((w / 2f) + 10, (h / 2f) - 70, (w / 2f) - 10, (h / 2f) - 20, iconPaint);

        // Text
        using var textPaint = new SKPaint
        {
            Color = new SKColor(161, 161, 170), // #a1a1aa
            IsAntialias = true
        };
        using var font = new SKFont(SKTypeface.Default, 28);
        canvas.DrawText("Image Unavailable", w / 2f, (h / 2f) + 30, SKTextAlign.Center, font, textPaint);

        using var subTextPaint = new SKPaint
        {
            Color = new SKColor(113, 113, 122), // #71717a
            IsAntialias = true
        };
        using var subFont = new SKFont(SKTypeface.Default, 18);
        canvas.DrawText("Failed to load source image", w / 2f, (h / 2f) + 70, SKTextAlign.Center, subFont, subTextPaint);

        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Webp, 75);
        return data.ToArray();
    });

    private async Task<(string path, long size, int width, int height, bool isFallback)> SaveFallbackImageAsync(string subDir, string fileName, string relativePath, CancellationToken ct)
    {
        try
        {
            Directory.CreateDirectory(subDir);
            var filePath = Path.Combine(subDir, fileName);
            var bytes = FallbackBrokenImageBytes.Value;
            await File.WriteAllBytesAsync(filePath, bytes, ct);
            return (relativePath.Replace("\\", "/"), bytes.Length, 720, 1080, true);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to write fallback broken image to {SubDir}/{FileName}", subDir, fileName);
            return (relativePath.Replace("\\", "/"), 0, 0, 0, true);
        }
    }

    private async Task<(string path, long size, int width, int height, bool isFallback)> SaveImageAsync(string imageUrl, string subDir, string fileName, string relativePath, CancellationToken ct)
    {
        if (imageUrl.Contains("imgbox.com", StringComparison.OrdinalIgnoreCase))
        {
            imageUrl = System.Text.RegularExpressions.Regex.Replace(
                imageUrl,
                @"_(t|s)\.(jpe?g|png|webp)",
                "_o.$2",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        }

        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var parsedUri))
        {
            Logger.LogWarning("Image URL is not a valid absolute URI: '{ImageUrl}'. Saving fallback broken image.", imageUrl);
            return await SaveFallbackImageAsync(subDir, fileName, relativePath, ct);
        }

        try
        {
            return await ExecuteWithRetryAsync(async token =>
            {
                Stream? imageStream = null;
                const string defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

                void ConfigureReferrer(HttpRequestMessage req)
                {
                    if (parsedUri.Host.Contains("desu.pics", StringComparison.OrdinalIgnoreCase) ||
                        parsedUri.Host.Contains("doujin.desu", StringComparison.OrdinalIgnoreCase))
                    {
                        req.Headers.Referrer = new Uri("https://doujin.desu.xxx");
                    }
                    else if (parsedUri.Host.Contains("imgbox.com", StringComparison.OrdinalIgnoreCase))
                    {
                        req.Headers.Referrer = new Uri("https://imgbox.com/");
                    }
                    else if (_provider != null)
                    {
                        if (_provider.ProviderName == "MangaDex")
                        {
                            req.Headers.UserAgent.Clear();
                            req.Headers.TryAddWithoutValidation("User-Agent", "MangaScrapper/1.0");
                        }
                        else
                        {
                            req.Headers.Referrer = new Uri(_provider.BaseUrl);
                        }
                    }
                }

                try
                {
                    using var request = new HttpRequestMessage(HttpMethod.Get, imageUrl);
                    request.Headers.TryAddWithoutValidation("User-Agent", defaultUserAgent);
                    request.Headers.TryAddWithoutValidation("Accept", "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
                    ConfigureReferrer(request);

                    var response = await HttpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
                    response.EnsureSuccessStatusCode();
                    imageStream = await response.Content.ReadAsStreamAsync(token);
                }
                catch (Exception) when (FlareSolverrService is { IsEnabled: true })
                {
                    await FlareSolverrService.EnsureSessionAsync(imageUrl, token);
                    if (FlareSolverrService.TryGetSession(parsedUri.Host, out var userAgent, out var cookieHeader))
                    {
                        using var req2 = new HttpRequestMessage(HttpMethod.Get, imageUrl);
                        ConfigureReferrer(req2);
                        req2.Headers.TryAddWithoutValidation("User-Agent", !string.IsNullOrEmpty(userAgent) ? userAgent : defaultUserAgent);
                        req2.Headers.TryAddWithoutValidation("Accept", "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
                        if (!string.IsNullOrEmpty(cookieHeader)) req2.Headers.TryAddWithoutValidation("Cookie", cookieHeader);
                        var response2 = await HttpClient.SendAsync(req2, HttpCompletionOption.ResponseHeadersRead, token);
                        response2.EnsureSuccessStatusCode();
                        imageStream = await response2.Content.ReadAsStreamAsync(token);
                    }
                    else throw;
                }

                byte[] imageBytes;
                using (imageStream)
                {
                    using var memStream = new MemoryStream();
                    await imageStream!.CopyToAsync(memStream, token);
                    imageBytes = memStream.ToArray();
                }

                if (imageBytes.Length == 0 || (imageBytes.Length > 0 && (char)imageBytes[0] == '<'))
                {
                    throw new InvalidOperationException($"Invalid image payload (received HTML or empty response) for: {imageUrl}");
                }

                Directory.CreateDirectory(subDir);
                var filePath = Path.Combine(subDir, fileName);

                int width = 0;
                int height = 0;

                using (var dimStream = new MemoryStream(imageBytes, writable: false))
                {
                    var dims = ImageDimensionReader.GetDimensions(dimStream);
                    if (dims.Width > 0 && dims.Height > 0)
                    {
                        width = dims.Width;
                        height = dims.Height;
                    }
                    else
                    {
                        try
                        {
                            using var codec = SKCodec.Create(dimStream);
                            if (codec != null)
                            {
                                width = codec.Info.Width;
                                height = codec.Info.Height;
                            }
                        }
                        catch (Exception ex)
                        {
                            Logger.LogWarning(ex, "Failed to read image dimensions from stream for {ImageUrl}", imageUrl);
                        }
                    }
                }

                var isAvif = ImageDimensionReader.IsAvif(imageBytes) || IsAvifUrl(imageUrl);
                var isWebp = ImageDimensionReader.IsWebp(imageBytes) || IsWebpUrl(imageUrl);

                if (isAvif)
                {
                    if (!fileName.EndsWith(".avif", StringComparison.OrdinalIgnoreCase))
                    {
                        var nameWithoutExt = Path.GetFileNameWithoutExtension(fileName);
                        fileName = $"{nameWithoutExt}.avif";
                        filePath = Path.Combine(subDir, fileName);
                        var dirName = Path.GetDirectoryName(relativePath)?.Replace("\\", "/");
                        relativePath = string.IsNullOrEmpty(dirName) ? fileName : $"{dirName}/{fileName}";
                    }

                    await File.WriteAllBytesAsync(filePath, imageBytes, token);
                    return (relativePath.Replace("\\", "/"), new FileInfo(filePath).Length, width, height, false);
                }

                if (isWebp)
                {
                    if (!fileName.EndsWith(".webp", StringComparison.OrdinalIgnoreCase))
                    {
                        var nameWithoutExt = Path.GetFileNameWithoutExtension(fileName);
                        fileName = $"{nameWithoutExt}.webp";
                        filePath = Path.Combine(subDir, fileName);
                        var dirName = Path.GetDirectoryName(relativePath)?.Replace("\\", "/");
                        relativePath = string.IsNullOrEmpty(dirName) ? fileName : $"{dirName}/{fileName}";
                    }

                    await File.WriteAllBytesAsync(filePath, imageBytes, token);
                    return (relativePath.Replace("\\", "/"), new FileInfo(filePath).Length, width, height, false);
                }

                try
                {
                    using var imageData = SKData.CreateCopy(imageBytes);
                    using var skImage = SKImage.FromEncodedData(imageData);
                    
                    if (skImage != null)
                    {
                        if (width == 0 || height == 0)
                        {
                            width = skImage.Width;
                            height = skImage.Height;
                        }

                        using var encoded = skImage.Encode(SKEncodedImageFormat.Webp, 90);
                        if (encoded != null)
                        {
                            await Task.Run(() => { using var out2 = File.Create(filePath); encoded.SaveTo(out2); }, token);
                            return (relativePath.Replace("\\", "/"), new FileInfo(filePath).Length, width, height, false);
                        }
                    }

                    // Fallback using SKBitmap decoding if SKImage.Encode returned null
                    using (var bmpStream = new MemoryStream(imageBytes, writable: false))
                    using (var bitmap = SKBitmap.Decode(bmpStream))
                    {
                        if (bitmap != null)
                        {
                            if (width == 0 || height == 0)
                            {
                                width = bitmap.Width;
                                height = bitmap.Height;
                            }
                            using var encodedBmp = bitmap.Encode(SKEncodedImageFormat.Webp, 90);
                            if (encodedBmp != null)
                            {
                                await Task.Run(() => { using var out2 = File.Create(filePath); encodedBmp.SaveTo(out2); }, token);
                                return (relativePath.Replace("\\", "/"), new FileInfo(filePath).Length, width, height, false);
                            }
                        }
                    }

                    throw new InvalidOperationException($"SkiaSharp could not encode image to WebP from: {imageUrl}");
                }
                catch (Exception ex)
                {
                    Logger.LogWarning(ex, "SkiaSharp failed to decode/encode {ImageUrl}. Saving raw stream.", imageUrl);
                    await File.WriteAllBytesAsync(filePath, imageBytes, token);
                    return (relativePath.Replace("\\", "/"), new FileInfo(filePath).Length, width, height, false);
                }
            }, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to download image from '{ImageUrl}'. Generating fallback broken image.", imageUrl);
            return await SaveFallbackImageAsync(subDir, fileName, relativePath, ct);
        }
    }

    private static bool IsWebpUrl(string imageUrl)
    {
        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri))
            return imageUrl.Contains(".webp", StringComparison.OrdinalIgnoreCase);
        return string.Equals(Path.GetExtension(uri.AbsolutePath), ".webp", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsAvifUrl(string imageUrl)
    {
        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri))
            return imageUrl.Contains(".avif", StringComparison.OrdinalIgnoreCase);
        return string.Equals(Path.GetExtension(uri.AbsolutePath), ".avif", StringComparison.OrdinalIgnoreCase);
    }


    public async Task<Manga> UpdateMangaMetaData(Manga manga, CancellationToken ct = default)
    {
        using var scope = ScopeFactory.CreateScope();
        var externalService = scope.ServiceProvider.GetRequiredService<IExternalMetadataService>();

        try
        {
            var anilistList = await externalService.SearchAnilistAsync(manga.Title,manga.AnilistId, ct);
            if (anilistList.Count > 0 && manga.AnilistId != null && manga.AnilistId!=0)
            {
                manga.UpdateFromAnilist(anilistList.First());
            }
            else if (anilistList.Count > 0)
            {
                var matched = anilistList.FirstOrDefault(a =>
                    (manga.MalId != 0 && a.MalId == manga.MalId) ||
                    (manga.AnilistId.HasValue && a.AnilistId == manga.AnilistId) ||
                    StringHelper.IsSimilar(a.Title, manga.Title) ||
                    StringHelper.CalculateSimilarity(a.Title, manga.Title) >= 0.8);

                if (matched != null)
                {
                    manga.UpdateFromAnilist(matched);
                }
            }
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to fetch AniList metadata for {MangaTitle}", manga.Title);
        }

        return manga;
    }

    private async Task<Manga> UpdateThumbnail(Manga manga, string? imageUrl, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(imageUrl))
        {
            manga.UpdateImageUrl(ThumbnailHelper.RemoveResizeParams(imageUrl));
            var thumb = await DownloadThumbnailAndConvertToWebP(manga.Title, imageUrl, ct);
            manga.UpdateLocalImage(thumb.path, thumb.size);
        }
        return manga;
    }

    private void UpdateChapterViews(Manga existingManga, List<Chapter> chapters)
    {
        foreach (var item in existingManga.Chapters)
        {
            var chapIndex = chapters.FirstOrDefault(x => x.Number == item.Number);
            if (chapIndex != null && item.TotalView < chapIndex.TotalView)
                item.UpdateTotalView(chapIndex.TotalView);
        }
    }

    public async Task<Manga> ExtractManga(string url, CancellationToken ct, bool scrapChapters = true, string? linkedId = null)
    {
        var mangaData = ExtractMangaMetadata(url);
        mangaData.SetUrl(url);

        if (string.IsNullOrWhiteSpace(mangaData.Title))
            throw new ArgumentException("Missing Manga Title!");

        Manga? existingManga = null;
        if (!string.IsNullOrEmpty(linkedId) && Guid.TryParse(linkedId, out var parsedGuid))
        {
            existingManga = await _mangaRepo.GetByIdAsync(MangaId.From(parsedGuid), ct);
        }

        if (existingManga == null)
        {
            existingManga = await _mangaRepo.GetByTitleAsync(mangaData.Title, ct);
        }

        if (existingManga == null)
        {
            try
            {
                var searchManga = await MeilisearchService.SearchTitleAsync(mangaData.Title, ct);
                if (searchManga is not null && StringHelper.CalculateSimilarity(searchManga.Title, mangaData.Title) >= 0.8)
                {
                    if (Guid.TryParse(searchManga.Id, out var searchGuid))
                    {
                        existingManga = await _mangaRepo.GetByIdAsync(MangaId.From(searchGuid), ct);
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.LogWarning(ex, "Failed to perform Meilisearch title lookup for {MangaTitle}", mangaData.Title);
            }
        }

        var chapters = await ExtractChaptersMetadata(ct);

        if (existingManga != null)
        {
            var existingNumbers = existingManga.Chapters.Select(c => c.Number).ToHashSet();
            var newChapters = chapters.Where(c => !existingNumbers.Contains(c.Number)).ToList();

            if (newChapters.Any())
            {
                existingManga.AddChapters(newChapters);

                if (scrapChapters)
                {
                    foreach (var chapter in newChapters)
                    {
                        try
                        {
                            await QueueChapterScraping(existingManga.Id.Value, existingManga.Title, chapter, ct);
                        }
                        catch (Exception ex)
                        {
                            Logger.LogError(ex, "Failed to queue scraping for chapter {ChapterNumber} of {MangaTitle}", chapter.Number, existingManga.Title);
                        }
                    }
                }

                try
                {
                    using var scope = ScopeFactory.CreateScope();
                    var webhookService = scope.ServiceProvider.GetService<DiscordWebhookService>();
                    if (webhookService != null)
                        await webhookService.SendNewChaptersNotificationAsync(existingManga, newChapters, ct);

                    var fcmService = scope.ServiceProvider.GetService<FcmNotificationService>();
                    if (fcmService != null)
                    {
                        foreach (var chapter in newChapters)
                        {
                            await fcmService.SendNewChapterNotificationToUserLibraryAsync(
                                existingManga.Id.Value,
                                existingManga.Title,
                                chapter.Number,
                                existingManga.ImageUrl,
                                ct);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Logger.LogWarning(ex, "Failed to send notifications for new chapters of {MangaTitle}", existingManga.Title);
                }
            }

            existingManga = await UpdateMangaMetaData(existingManga, ct);
            UpdateChapterViews(existingManga, chapters);
            await _mangaRepo.UpdateAsync(existingManga, ct);

            try
            {
                await MeilisearchService.IndexMangaAsync(existingManga, ct);
                await QdrantService.UpsertMangaAsync(existingManga, ct);
            }
            catch (Exception ex)
            {
                Logger.LogWarning(ex, "Failed to sync search indexes for {MangaTitle}", existingManga.Title);
            }

            return existingManga;
        }

        mangaData = await UpdateThumbnail(mangaData, mangaData.ImageUrl, ct);
        mangaData.AddChapters(chapters);
        var createdAt = chapters.OrderBy(x => x.UploadDate).FirstOrDefault()?.UploadDate;
        if (createdAt == null || createdAt == DateTime.MinValue)
            createdAt = DateTime.UtcNow;
        mangaData.SetDates(createdAt.Value, DateTime.UtcNow);
        if (mangaData.Type.Contains('-')) mangaData.SetType("Manga");

        var manga = await UpdateMangaMetaData(mangaData, ct);
        await _mangaRepo.AddAsync(manga, ct);

        try
        {
            await MeilisearchService.IndexMangaAsync(manga, ct);
            await QdrantService.UpsertMangaAsync(manga, ct);
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to sync search indexes for new manga {MangaTitle}", manga.Title);
        }

        if (scrapChapters)
        {
            foreach (var chapter in chapters)
            {
                try
                {
                    await QueueChapterScraping(manga.Id.Value, manga.Title, chapter, ct);
                }
                catch (Exception ex)
                {
                    Logger.LogError(ex, "Failed to queue scraping for chapter {ChapterNumber} of {MangaTitle}", chapter.Number, manga.Title);
                }
            }
        }

        try
        {
            using var webhookScope = ScopeFactory.CreateScope();
            var discord = webhookScope.ServiceProvider.GetService<DiscordWebhookService>();
            if (discord != null)
                await discord.SendNewMangaNotificationAsync(manga, chapters, ct);
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to send new manga notification for {MangaTitle}", manga.Title);
        }

        return manga;
    }

    public async Task<Manga> GetDetail(string url, CancellationToken ct)
    {
        var mangaData = ExtractMangaMetadata(url);
        if (string.IsNullOrEmpty(mangaData.Title))
            throw new ArgumentException("Missing Manga Title!");
        var chapters = await ExtractChaptersMetadata(ct);
        mangaData.AddChapters(chapters);
        if (mangaData.Type.Contains('-')) mangaData.SetType("Manga");
        return mangaData;
    }

    protected abstract Manga ExtractMangaMetadata(string url);
    protected abstract Task<List<Chapter>> ExtractChaptersMetadata(CancellationToken ct = default);

    public virtual async Task<Chapter> GetChapterPage(string mangaTitle, Chapter chapter, CancellationToken ct = default, Func<int, int, Task>? onProgress = null)
    {
        var url = chapter.Link;
        if (string.IsNullOrWhiteSpace(url)) return chapter;
        if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            url = Provider.BaseUrl.TrimEnd('/') + "/" + url.TrimStart('/');

        var doc = await GetHtml(url, ct: ct);
        var imageNodes = doc.DocumentNode.SelectNodes(Provider.PageSelectors.Images);
        if (imageNodes == null) return chapter;

        var total = imageNodes.Count;
        var completed = 0;
        if (onProgress != null && total > 0)
        {
            await onProgress(0, total);
        }

        var downloadTasks = imageNodes.Select(async (imgNode, index) =>
        {
            var imageUrl = imgNode.GetAttributeValue("src", string.Empty);
            if (string.IsNullOrWhiteSpace(imageUrl)) return (Index: index, Page: null as Page);

            await Semaphore.WaitAsync(ct);
            try
            {
                var result = await DownloadAndConvertToWebP(mangaTitle, chapter.Number.ToString(CultureInfo.InvariantCulture), imageUrl, index + 1, ct);
                var current = Interlocked.Increment(ref completed);
                if (onProgress != null)
                {
                    await onProgress(current, total);
                }
                return (Index: index, Page: new Page(Guid.CreateVersion7(), imageUrl, result.path, result.size, result.width, result.height, result.isFallback));
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Failed to download/convert image at index {Index} for {MangaTitle}", index, mangaTitle);
                throw;
            }
            finally { Semaphore.Release(); }
        });

        var results = await Task.WhenAll(downloadTasks);
        chapter.AddPages(results.OrderBy(r => r.Index).Where(r => r.Page != null).Select(r => r.Page!).ToList());
        return chapter;
    }

    public async Task QueueChapterScraping(Guid mangaId, string mangaTitle, Chapter chapter, CancellationToken ct = default)
    {
        var integrationEvent = new ScrapChapterPagesIntegrationEvent(
            mangaId, mangaTitle, chapter.Number, chapter.Id.Value.ToString(), ProviderKey);
        await EventBus.PublishAsync(integrationEvent, "scrape-chapter-pages", ct);
    }

    public abstract Task<List<SearchItem>> SearchManga(SearchRequest request, CancellationToken ct);

    protected async Task EnrichSearchItemAsync(SearchItem item, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(item.Title)) return;
        var searchManga = await MeilisearchService.SearchTitleAsync(item.Title, ct);
        if (searchManga != null && StringHelper.CalculateSimilarity(searchManga.Title, item.Title) >= 0.8)
        {
            var doc = await _mangaRepo.GetByIdAsync(MangaId.From(Guid.Parse(searchManga.Id)), ct);
            if (doc != null)
            {
                item.CurrentChapterNumber = doc.Chapters?.Any() == true ? doc.Chapters.Max(c => c.Number) : 0;
                item.MangaId = doc.Id.Value.ToString();
            }
        }
    }

    public async Task<List<Page>> GetAllPages(string url, CancellationToken ct = default)
    {
        var chapter = new Chapter(ChapterId.New(), 0, url, null, null, DefaultIndonesianLanguage, 0, DateTime.UtcNow);
        return (await GetChapterPage("temp", chapter, ct, null)).Pages;
    }

    public async Task<List<ScrapperProvider>> GetAllProvider()
    {
        var providers = new List<ScrapperProvider>();
        var providerFolder = Path.Combine(Directory.GetCurrentDirectory(), "provider");
        if (!Directory.Exists(providerFolder)) return providers;

        foreach (var file in Directory.GetFiles(providerFolder, "*.json"))
        {
            try
            {
                var json = await File.ReadAllTextAsync(file);
                var provider = JsonSerializer.Deserialize<ScrapperProvider>(json);
                if (provider != null) providers.Add(provider);
            }
            catch { /* skip invalid files */ }
        }
        return providers;
    }

    async Task<ScrapperMangaDocumentResponse> IProviderScrapperService.ExtractManga(string url, CancellationToken ct, bool scrapChapters, string? linkedId)
    {
        var manga = await ExtractManga(url, ct, scrapChapters, linkedId);
        return MapToResponse(manga);
    }

    async Task<ScrapperMangaDocumentResponse> IProviderScrapperService.GetDetail(string url, CancellationToken ct)
    {
        var manga = await GetDetail(url, ct);
        return MapToResponse(manga);
    }

    async Task<List<SearchItemResponse>> IProviderScrapperService.SearchManga(ScrapperSearchRequest request, CancellationToken ct)
    {
        var req = new SearchRequest
        {
            Keyword = request.Keyword,
            Genres = request.Genres.ToList(),
            Status = request.Status,
            Type = request.Type,
            Page = request.Page
        };
        var items = await SearchManga(req, ct);
        return items.Select(i => new SearchItemResponse
        {
            Title = i.Title,
            DetailUrl = i.DetailUrl,
            Thumbnail = i.Thumbnail,
            Type = i.Type,
            Genre = i.Genre,
            LastUpdateText = i.LastUpdateText,
            LatestChapterNumber = i.LatestChapterNumber,
            LatestScrapped = i.LatestScrapped,
            CurrentChapterNumber = i.CurrentChapterNumber,
            MangaId = i.MangaId
        }).ToList();
    }

    async Task<List<ProviderInfoResponse>> IProviderScrapperService.GetAllProvider()
    {
        var providers = await GetAllProvider();
        return providers.Select(p => new ProviderInfoResponse
        {
            ProviderName = p.ProviderName,
            BaseUrl = p.BaseUrl
        }).ToList();
    }

    private static ScrapperMangaDocumentResponse MapToResponse(Manga manga)
    {
        return new ScrapperMangaDocumentResponse
        {
            Id = manga.Id.Value,
            MalID = manga.MalId,
            Title = manga.Title,
            Author = manga.Author,
            Type = manga.Type,
            Rating = manga.Rating,
            Popularity = manga.Popularity,
            Members = manga.Members,
            Genres = manga.Genres,
            Description = manga.Description,
            ImageUrl = manga.ImageUrl,
            LocalImageUrl = manga.LocalImageUrl,
            ThumbnailSize = manga.ThumbnailSize,
            Status = manga.Status,
            ReleaseDate = manga.ReleaseDate,
            TotalView = manga.TotalView,
            CreatedAt = manga.CreatedAt,
            UpdatedAt = manga.UpdatedAt,
            Url = manga.Url,
            Chapters = manga.Chapters?.Select(c => new ScrapperChapterDocumentResponse
            {
                Id = c.Id.Value,
                Number = c.Number,
                Link = c.Link,
                ChapterProvider = c.ChapterProvider,
                ChapterProviderIcon = c.ChapterProviderIcon,
                Language = c.Language,
                TotalView = c.TotalView,
                UploadDate = c.UploadDate,
                Pages = c.Pages?.Select(p => new ScrapperPageDocumentResponse
                {
                    ImageUrl = p.ImageUrl,
                    LocalImageUrl = p.LocalImageUrl ?? string.Empty,
                    Size = p.Size,
                    Width = p.Width,
                    Height = p.Height,
                    IsFallback = p.IsFallback
                }).ToList() ?? new()
            }).ToList() ?? new()
        };
    }
}

