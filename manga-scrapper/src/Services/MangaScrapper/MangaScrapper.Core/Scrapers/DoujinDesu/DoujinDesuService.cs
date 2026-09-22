using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.Utils;
using MangaScrapper.Core.ValueObjects;
using Microsoft.AspNetCore.WebUtilities;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Scrapers.DoujinDesu;

public class DoujinDesuService : ScrapperServiceBase
{
    protected override string ProviderKey => "doujindesu";

    private const string BaseApi = "https://doujin.desu.xxx/api";
    private const string BaseUrl = "https://doujin.desu.xxx";

    private static readonly Regex GuidRegex = new(
        @"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private List<DoujinDesuChapterItemDto> _cachedChapters = [];

    public DoujinDesuService(
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
        : base(httpClient, mangaRepo, eventBus, scopeFactory, settings, semaphore, meilisearchService, qdrantService, loggerFactory, flareSolverrService)
    {
        LoadProvider("doujindesu-provider.json");
    }

    private async Task<T?> GetEncryptedJsonAsync<T>(string url, CancellationToken ct = default)
    {
        var appSecret = !string.IsNullOrWhiteSpace(Provider.AppSecret) ? Provider.AppSecret : DoujinDesuDecryptor.AppSecret;
        var salt = !string.IsNullOrWhiteSpace(Provider.Salt) ? Provider.Salt : DoujinDesuDecryptor.Salt;

        return await ExecuteWithRetryAsync(async token =>
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
            request.Headers.TryAddWithoutValidation("X-App-Secret", appSecret);
            request.Headers.TryAddWithoutValidation("x-app-secret", appSecret);
            request.Headers.Referrer = new Uri(BaseUrl);

            var response = await HttpClient.SendAsync(request, token);
            response.EnsureSuccessStatusCode();

            var raw = await response.Content.ReadAsStringAsync(token);
            return DoujinDesuDecryptor.DecryptToObject<T>(raw, salt);
        }, ct);
    }

    protected override Manga ExtractMangaMetadata(string url)
    {
        var slug = ExtractSlugFromUrl(url);
        var apiUrl = $"{BaseApi}/manga/{slug}";

        var mangaDto = GetEncryptedJsonAsync<DoujinDesuMangaDto>(apiUrl).GetAwaiter().GetResult()
            ?? throw new InvalidOperationException($"Failed to fetch DoujinDesu manga '{slug}'.");

        _cachedChapters = mangaDto.Chapters ?? [];

        return MapMangaToDomain(mangaDto, url);
    }

    protected override Task<List<Chapter>> ExtractChaptersMetadata(CancellationToken ct = default)
    {
        var chapters = new List<Chapter>();

        foreach (var chapDto in _cachedChapters)
        {
            var chapter = new Chapter(
                id: ChapterId.New(),
                number: chapDto.ChapterNumber > 0 ? chapDto.ChapterNumber : 1,
                link: $"{BaseApi}/chapters/{chapDto.Id}",
                chapterProvider: Provider.ProviderName,
                chapterProviderIcon: Provider.ProviderIcon,
                language: DefaultIndonesianLanguage,
                totalView: chapDto.Views ?? 0,
                uploadDate: chapDto.CreatedAt ?? DateTime.UtcNow);

            chapters.Add(chapter);
        }

        return Task.FromResult(chapters.OrderByDescending(c => c.Number).ToList());
    }

    private Manga MapMangaToDomain(DoujinDesuMangaDto dto, string originalUrl)
    {
        var author = dto.Author;
        if (string.IsNullOrWhiteSpace(author) && !string.IsNullOrWhiteSpace(dto.TermList))
        {
            var authorTerms = dto.TermList.Split('|')
                .Select(t => t.Split(':'))
                .Where(parts => parts.Length >= 2 && parts[1].Equals("author", StringComparison.OrdinalIgnoreCase))
                .Select(parts => parts[0].Trim())
                .ToList();

            if (authorTerms.Count > 0)
            {
                author = string.Join(", ", authorTerms);
            }
        }

        var genres = new List<string>();
        if (dto.MangaGenres != null && dto.MangaGenres.Count > 0)
        {
            genres.AddRange(dto.MangaGenres
                .Where(g => g.Genres?.Name != null)
                .Select(g => g.Genres!.Name!));
        }
        else if (!string.IsNullOrWhiteSpace(dto.TermList))
        {
            var genreTerms = dto.TermList.Split('|')
                .Select(t => t.Split(':'))
                .Where(parts => parts.Length >= 2 && parts[1].Equals("genre", StringComparison.OrdinalIgnoreCase))
                .Select(parts => parts[0].Trim());

            genres.AddRange(genreTerms);
        }
        else if (!string.IsNullOrWhiteSpace(dto.Terms))
        {
            var terms = dto.Terms.Split(',')
                .Select(t => t.Split(':'))
                .Where(parts => parts.Length >= 2 && parts[1].Equals("genre", StringComparison.OrdinalIgnoreCase))
                .Select(parts => parts[0].Trim());

            genres.AddRange(terms);
        }

        var type = !string.IsNullOrWhiteSpace(dto.Type)
            ? char.ToUpperInvariant(dto.Type[0]) + dto.Type[1..]
            : "Doujinshi";

        var status = dto.Status?.ToLowerInvariant() switch
        {
            "completed" => "Completed",
            "ongoing" => "Ongoing",
            _ => "Completed"
        };

        var pageUrl = originalUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? originalUrl
            : $"{BaseUrl}/manga/{dto.Slug}";

        return Manga.Create(
            title: dto.Title,
            author: author ?? "Unknown",
            type: type,
            source: ProviderKey,
            genres: genres.Distinct().ToList(),
            description: dto.Description ?? string.Empty,
            imageUrl: dto.CoverUrl,
            url: pageUrl,
            rating: dto.Rating,
            status: status,
            nsfw:true,
            releaseDate: dto.CreatedAt);
    }

    public override async Task<Chapter> GetChapterPage(string mangaTitle, Chapter chapter, CancellationToken ct = default, Func<int, int, Task>? onProgress = null)
    {
        var url = chapter.Link;
        if (string.IsNullOrWhiteSpace(url))
            return chapter;

        var chapterId = ExtractChapterIdFromUrl(url);
        var apiUrl = $"{BaseApi}/chapters/{chapterId}";

        var chapterDetail = await GetEncryptedJsonAsync<DoujinDesuChapterDetailDto>(apiUrl, ct);
        if (chapterDetail?.ContentUrls == null || chapterDetail.ContentUrls.Count == 0)
            return chapter;

        var imageUrls = chapterDetail.ContentUrls.Where(u => !string.IsNullOrWhiteSpace(u)).ToList();
        var total = imageUrls.Count;
        var completed = 0;

        if (onProgress != null && total > 0)
        {
            await onProgress(0, total);
        }

        var downloadTasks = imageUrls.Select(async (imageUrl, index) =>
        {
            if (string.IsNullOrWhiteSpace(imageUrl))
                return (Index: index, Page: null as Page);

            await Semaphore.WaitAsync(ct);
            try
            {
                var result = await DownloadAndConvertToWebP(
                    mangaTitle,
                    chapter.Number.ToString(CultureInfo.InvariantCulture),
                    imageUrl,
                    index + 1,
                    ct);

                var current = Interlocked.Increment(ref completed);
                if (onProgress != null)
                {
                    await onProgress(current, total);
                }

                return (Index: index, Page: new Page(Guid.CreateVersion7(), imageUrl, result.path, result.size, result.width, result.height, result.isFallback));
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Failed to download/convert image at index {Index} for {MangaTitle} (DoujinDesu)", index, mangaTitle);
                throw;
            }
            finally
            {
                Semaphore.Release();
            }
        });

        var results = await Task.WhenAll(downloadTasks);

        var orderedPages = results
            .OrderBy(r => r.Index)
            .Where(r => r.Page != null)
            .Select(r => r.Page!)
            .ToList();

        chapter.AddPages(orderedPages);
        return chapter;
    }

    public override async Task<List<SearchItem>> SearchManga(SearchRequest request, CancellationToken ct)
    {
        const int pageSize = 24;
        var offset = Math.Max(0, (request.Page - 1) * pageSize);

        var queryParams = new List<KeyValuePair<string, string?>>
        {
            new("search", request.Keyword ?? string.Empty),
            new("status", request.Status ?? string.Empty),
            new("type", request.Type ?? string.Empty),
            new("sort", "newest"),
            new("limit", pageSize.ToString()),
            new("offset", offset.ToString()),
        };

        if (request.Genres != null && request.Genres.Count > 0)
        {
            queryParams.Add(new("genre", string.Join(",", request.Genres)));
        }
        else
        {
            queryParams.Add(new("genre", string.Empty));
        }

        var searchUrl = QueryHelpers.AddQueryString($"{BaseApi}/manga", queryParams);

        List<DoujinDesuMangaDto>? items;
        try
        {
            items = await GetEncryptedJsonAsync<List<DoujinDesuMangaDto>>(searchUrl, ct);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to search DoujinDesu manga for query '{Query}'", request.Keyword);
            return [];
        }

        if (items == null || items.Count == 0)
            return [];

        var searchItems = new List<SearchItem>();
        foreach (var item in items)
        {
            var latestChapter = item.Chapters?.OrderByDescending(c => c.ChapterNumber).FirstOrDefault()?.ChapterNumber
                                ?? item.ChapterCount
                                ?? 1;

            var genreString = string.Empty;
            if (item.MangaGenres != null && item.MangaGenres.Count > 0)
            {
                genreString = string.Join(", ", item.MangaGenres.Where(g => g.Genres?.Name != null).Select(g => g.Genres!.Name));
            }
            else if (!string.IsNullOrWhiteSpace(item.Terms))
            {
                genreString = string.Join(", ", item.Terms.Split(',').Select(t => t.Split(':')[0]));
            }

            searchItems.Add(new SearchItem
            {
                Title = item.Title,
                DetailUrl = $"{BaseUrl}/manga/{item.Slug}",
                Thumbnail = item.CoverUrl ?? string.Empty,
                Type = !string.IsNullOrWhiteSpace(item.Type) ? char.ToUpperInvariant(item.Type[0]) + item.Type[1..] : "Doujinshi",
                Genre = genreString,
                LastUpdateText = item.UpdatedAt?.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) ?? string.Empty,
                LatestChapterNumber = latestChapter,
                CurrentChapterNumber = latestChapter,
                MangaId = item.Id
            });
        }

        return searchItems;
    }

    private static string ExtractSlugFromUrl(string url)
    {
        var trimmed = url.Trim().TrimEnd('/');
        var lastSegment = trimmed.Split('/').Last();
        return lastSegment.Split('?').First();
    }

    private static string ExtractChapterIdFromUrl(string url)
    {
        var match = GuidRegex.Match(url);
        if (match.Success)
            return match.Value;

        var trimmed = url.Trim().TrimEnd('/');
        return trimmed.Split('/').Last().Split('?').First();
    }
}
