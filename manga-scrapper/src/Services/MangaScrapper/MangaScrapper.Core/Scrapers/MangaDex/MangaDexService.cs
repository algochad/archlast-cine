using System.Globalization;
using System.Text.RegularExpressions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Persistence.Documents;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.Utils;
using MangaScrapper.Core.ValueObjects;
using Microsoft.AspNetCore.WebUtilities;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Scrapers.MangaDex;

public class MangaDexService : ScrapperServiceBase
{
    protected override string ProviderKey => "mangadex";

    private const string BaseApi = "https://api.mangadex.org";
    private const string CoverBaseUrl = "https://uploads.mangadex.org/covers";
    private static readonly string[] ChapterLanguagePriority = ["id", "en"];
    private static readonly Regex MangaIdRegex = new(
        @"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private string _mangaId = string.Empty;

    public MangaDexService(
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
        LoadProvider("mangadex-provider.json");
    }

    // â”€â”€â”€ Detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    protected override Manga ExtractMangaMetadata(string url)
    {
        _mangaId = ExtractMangaIdFromUrl(url);

        var queryParams = new List<KeyValuePair<string, string?>>
        {
            new("includes[]", "cover_art"),
            new("includes[]", "author"),
            new("includes[]", "artist"),
        };

        var mangaUrl = QueryHelpers.AddQueryString($"{BaseApi}/manga/{_mangaId}", queryParams);
        var response = GetFromJsonAsync<MangaDexResponse<MangaDexManga>>(mangaUrl).GetAwaiter().GetResult()
            ?? throw new InvalidOperationException($"Failed to fetch MangaDex manga '{_mangaId}'.");

        if (response.Data == null)
            throw new InvalidOperationException($"MangaDex manga '{_mangaId}' was not found.");

        double? rating = null;
        try
        {
            var statsUrl = $"{BaseApi}/statistics/manga/{_mangaId}";
            var statsResponse = GetFromJsonAsync<MangaDexStatisticsResponse>(statsUrl).GetAwaiter().GetResult();
            if (statsResponse?.Statistics != null && statsResponse.Statistics.TryGetValue(_mangaId, out var stats))
            {
                rating = stats.Rating?.Average;
            }
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to fetch MangaDex statistics for manga '{MangaId}'", _mangaId);
        }

        return MapMangaToDomain(response.Data, rating);
    }

    protected override async Task<List<Chapter>> ExtractChaptersMetadata(CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_mangaId))
            return new List<Chapter>();

        var feedChapters = await FetchAllMangaChaptersAsync(_mangaId, ct);
        if (feedChapters.Count == 0)
            return new List<Chapter>();

        var chapters = new List<Chapter>();

        foreach (var group in feedChapters.GroupBy(GetChapterNumber).Where(g => g.Key >= 0))
        {
            var selected = SelectChapterByLanguagePriority(group);
            chapters.Add(MapChapterToDomain(selected));
        }

        return chapters
            .OrderByDescending(c => c.Number)
            .ToList();
    }

    private async Task<List<MangaDexChapter>> FetchAllMangaChaptersAsync(string mangaId, CancellationToken ct)
    {
        const int pageSize = 500;
        var offset = 0;
        var allChapters = new List<MangaDexChapter>();

        while (true)
        {
            var queryParams = new List<KeyValuePair<string, string?>>
            {
                new("limit", pageSize.ToString()),
                new("offset", offset.ToString()),
                new("translatedLanguage[]", "id"),
                new("translatedLanguage[]", "en"),
                new("order[chapter]", "desc"),
                new("contentRating[]", "safe"),
                new("contentRating[]", "suggestive"),
                new("contentRating[]", "erotica"),
                new("contentRating[]", "pornographic"),
            };

            var feedUrl = QueryHelpers.AddQueryString($"{BaseApi}/manga/{mangaId}/feed", queryParams);
            MangaDexResponse<List<MangaDexChapter>>? response;

            try
            {
                response = await GetFromJsonAsync<MangaDexResponse<List<MangaDexChapter>>>(feedUrl, ct);
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Failed to fetch MangaDex chapter feed for manga '{MangaId}'", mangaId);
                break;
            }

            if (response?.Data == null || response.Data.Count == 0)
                break;

            allChapters.AddRange(response.Data);

            if (offset + response.Data.Count >= response.Total)
                break;

            offset += pageSize;
            await Task.Delay(250, ct);
        }

        return allChapters;
    }

    private Manga MapMangaToDomain(MangaDexManga manga, double? rating = null)
    {
        var attrs = manga.Attributes;
        var coverRel = manga.Relationships.FirstOrDefault(r => r.Type == "cover_art");
        var imageUrl = coverRel?.Attributes?.FileName != null
            ? $"{CoverBaseUrl}/{manga.Id}/{coverRel.Attributes.FileName}"
            : null;

        var authors = manga.Relationships
            .Where(r => r.Type == "author")
            .Select(r => r.Attributes?.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToList();

        var genres = attrs.Tags
            .Select(t => t.Attributes.Name.TryGetValue("en", out var n) ? n : string.Empty)
            .Where(n => !string.IsNullOrEmpty(n))
            .ToList();

        return Manga.Create(
            title: ResolveTitle(attrs.Title),
            author: string.Join(", ", authors),
            type: MapOriginalLanguageToType(attrs.OriginalLanguage),
            source: ProviderKey,
            genres: genres,
            description: ResolveDescription(attrs.Description),
            imageUrl: imageUrl,
            url: $"https://mangadex.org/title/{manga.Id}",
            rating: rating,
            status: MapMangaStatus(attrs.Status));
    }

    private Chapter MapChapterToDomain(MangaDexChapter chapter)
    {
        return new Chapter(
            id: ChapterId.New(),
            number: GetChapterNumber(chapter),
            link: $"https://mangadex.org/chapter/{chapter.Id}",
            chapterProvider: Provider.ProviderName,
            chapterProviderIcon: Provider.ProviderIcon,
            language: chapter.Attributes.TranslatedLanguage,
            totalView: 0,
            uploadDate: chapter.Attributes.ReadableAt);
    }

    private static MangaDexChapter SelectChapterByLanguagePriority(IEnumerable<MangaDexChapter> chapters)
    {
        var list = chapters.ToList();

        foreach (var lang in ChapterLanguagePriority)
        {
            var match = list.FirstOrDefault(c =>
                string.Equals(c.Attributes.TranslatedLanguage, lang, StringComparison.OrdinalIgnoreCase));

            if (match != null)
                return match;
        }

        return list[0];
    }

    private static double GetChapterNumber(MangaDexChapter chapter)
    {
        return double.TryParse(
            chapter.Attributes.Chapter,
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out var number)
            ? number
            : -1;
    }

    private static string ExtractMangaIdFromUrl(string url)
    {
        var match = MangaIdRegex.Match(url);
        if (!match.Success)
            throw new ArgumentException($"Could not extract MangaDex manga id from url: {url}");

        return match.Value;
    }

    private static string ResolveDescription(Dictionary<string, string>? descriptionMap)
    {
        if (descriptionMap == null || descriptionMap.Count == 0)
            return string.Empty;

        foreach (var lang in new[] { "en", "id", "ja-ro", "ja" })
        {
            if (descriptionMap.TryGetValue(lang, out var description) && !string.IsNullOrWhiteSpace(description))
                return description;
        }

        return descriptionMap.Values.FirstOrDefault(d => !string.IsNullOrWhiteSpace(d)) ?? string.Empty;
    }

    private static string MapMangaStatus(string status) => status.ToLowerInvariant() switch
    {
        "ongoing" => "Ongoing",
        "completed" => "Completed",
        "hiatus" => "On Hiatus",
        "cancelled" => "Discontinued",
        _ => "Unknown",
    };

    // ──────────────────────────────────────────────
    // Chapter pages ────────────────────────────────

    public override async Task<Chapter> GetChapterPage(string mangaTitle, Chapter chapter, CancellationToken ct = default, Func<int, int, Task>? onProgress = null)
    {
        var url = chapter.Link;
        if (string.IsNullOrWhiteSpace(url))
            return chapter;

        var chapterId = ExtractChapterIdFromUrl(url);
        var atHomeUrl = $"{BaseApi}/at-home/server/{chapterId}";
        var response = await GetFromJsonAsync<MangaDexAtHomeResponse>(atHomeUrl, ct);

        if (response?.Chapter?.Data == null || response.Chapter.Data.Count == 0)
            return chapter;

        var imageUrls = response.Chapter.Data
            .Select(fileName => $"{response.BaseUrl}/data/{response.Chapter.Hash}/{fileName}")
            .ToList();

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
                Logger.LogError(ex, "Failed to download/convert image at index {Index} for {MangaTitle} (MangaDex)", index, mangaTitle);
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


    private static string ExtractChapterIdFromUrl(string url)
    {
        var match = MangaIdRegex.Match(url);
        if (!match.Success)
            throw new ArgumentException($"Could not extract MangaDex chapter id from url: {url}");

        return match.Value;
    }

    // â”€â”€â”€ Search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// <summary>
    /// Searches for manga using MangaDex.
    /// <para>
    /// When no keyword is supplied the chapter feed endpoint is used
    /// (<c>GET /chapter</c>) so the results are sorted by latest update.
    /// When a keyword is present the manga search endpoint is used
    /// (<c>GET /manga?title=â€¦</c>).
    /// </para>
    /// </summary>
    public override async Task<List<SearchItem>> SearchManga(SearchRequest request, CancellationToken ct)
    {
        return string.IsNullOrWhiteSpace(request.Keyword)
            ? await SearchByLatestUpdate(request, ct)
            : await SearchByKeyword(request, ct);
    }

    // â”€â”€â”€ Latest-update feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private async Task<List<SearchItem>> SearchByLatestUpdate(SearchRequest request, CancellationToken ct)
    {
        const int pageSize = 32;
        var offset = (request.Page - 1) * pageSize;

        // Build the chapter feed URL exactly as requested
        var queryParams = new List<KeyValuePair<string, string?>>
        {
            new("limit", pageSize.ToString()),
            new("offset", offset.ToString()),
            new("translatedLanguage[]", "en"),
            new("translatedLanguage[]", "id"),
            new("translatedLanguage[]", "ja"),
            new("includes[]", "user"),
            new("includes[]", "scanlation_group"),
            new("includes[]", "manga"),
            new("contentRating[]", "safe"),
            new("contentRating[]", "suggestive"),
            new("contentRating[]", "erotica"),
            new("contentRating[]", "pornographic"),
            new("order[readableAt]", "desc"),
        };

        var feedUrl = QueryHelpers.AddQueryString($"{BaseApi}/chapter", queryParams);

        MangaDexResponse<List<MangaDexChapter>>? feedResponse;
        try
        {
            feedResponse = await GetFromJsonAsync<MangaDexResponse<List<MangaDexChapter>>>(feedUrl, ct);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to fetch MangaDex chapter feed");
            return new List<SearchItem>();
        }

        if (feedResponse?.Data == null || feedResponse.Data.Count == 0)
            return new List<SearchItem>();

        // Deduplicate: keep only the most recent chapter per manga
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var chaptersToMap = new List<(MangaDexChapter Chapter, MangaDexRelationship MangaRel)>();

        foreach (var chapter in feedResponse.Data)
        {
            var mangaRel = chapter.Relationships
                .FirstOrDefault(r => r.Type == "manga");

            if (mangaRel == null) continue;
            if (!seen.Add(mangaRel.Id)) continue;   // already handled this manga

            chaptersToMap.Add((chapter, mangaRel));
        }

        // Fetch cover art via manga details API in batch
        var coverMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (chaptersToMap.Count > 0)
        {
            var mangaQueryParams = new List<KeyValuePair<string, string?>>
            {
                new("limit", "100"),
                new("includes[]", "cover_art"),
                new("contentRating[]", "safe"),
                new("contentRating[]", "suggestive"),
                new("contentRating[]", "erotica"),
                new("contentRating[]", "pornographic"),
            };

            foreach (var pair in chaptersToMap)
            {
                mangaQueryParams.Add(new("ids[]", pair.MangaRel.Id));
            }

            var mangaUrl = QueryHelpers.AddQueryString($"{BaseApi}/manga", mangaQueryParams);
            try
            {
                var mangaResponse = await GetFromJsonAsync<MangaDexResponse<List<MangaDexManga>>>(mangaUrl, ct);
                if (mangaResponse?.Data != null)
                {
                    foreach (var manga in mangaResponse.Data)
                    {
                        var coverRel = manga.Relationships.FirstOrDefault(r => r.Type == "cover_art");
                        if (coverRel?.Attributes?.FileName != null)
                        {
                            coverMap[manga.Id] = $"{CoverBaseUrl}/{manga.Id}/{coverRel.Attributes.FileName}.512.jpg";
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.LogWarning(ex, "Failed to fetch cover art for manga feed");
            }
        }

        var results = new List<SearchItem>();
        foreach (var (chapter, mangaRel) in chaptersToMap)
        {
            coverMap.TryGetValue(mangaRel.Id, out var thumbnail);
            var item = MapChapterToSearchItem(chapter, mangaRel, thumbnail ?? string.Empty);
            await EnrichSearchItemAsync(item, ct);
            results.Add(item);
        }

        return results;
    }

    // â”€â”€â”€ Keyword search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private async Task<List<SearchItem>> SearchByKeyword(SearchRequest request, CancellationToken ct)
    {
        const int pageSize = 20;
        var offset = (request.Page - 1) * pageSize;

        var queryParams = new List<KeyValuePair<string, string?>>
        {
            new("title", request.Keyword),
            new("limit", pageSize.ToString()),
            new("offset", offset.ToString()),
            new("includes[]", "cover_art"),
            new("includes[]", "author"),
            new("contentRating[]", "safe"),
            new("contentRating[]", "suggestive"),
            new("contentRating[]", "erotica"),
            new("contentRating[]", "pornographic"),
            new("order[relevance]", "desc"),
        };

        if (!string.IsNullOrWhiteSpace(request.Status))
            queryParams.Add(new("status[]", request.Status.ToLowerInvariant()));

        if (request.Genres != null)
        {
            foreach (var genre in request.Genres)
                queryParams.Add(new("includedTags[]", genre));
        }

        var searchUrl = QueryHelpers.AddQueryString($"{BaseApi}/manga", queryParams);

        MangaDexResponse<List<MangaDexManga>>? searchResponse;
        try
        {
            searchResponse = await GetFromJsonAsync<MangaDexResponse<List<MangaDexManga>>>(searchUrl, ct);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to fetch MangaDex manga search results for keyword '{Keyword}'", request.Keyword);
            return new List<SearchItem>();
        }

        if (searchResponse?.Data == null || searchResponse.Data.Count == 0)
            return new List<SearchItem>();

        var results = new List<SearchItem>();

        foreach (var manga in searchResponse.Data)
        {
            var item = MapMangaToSearchItem(manga);
            await EnrichSearchItemAsync(item, ct);
            results.Add(item);
        }

        return results;
    }

    // â”€â”€â”€ Mappers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// <summary>Maps a chapter feed entry (with embedded manga relationship) to <see cref="SearchItem"/>.</summary>
    private static SearchItem MapChapterToSearchItem(MangaDexChapter chapter, MangaDexRelationship mangaRel, string thumbnail)
    {
        var attrs = mangaRel.Attributes;

        var title = ResolveTitle(attrs?.Title);
        var chapterNumber = double.TryParse(
            chapter.Attributes.Chapter,
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out var num) ? num : 0;

        var genres = attrs?.Tags?
            .Select(t => t.Attributes.Name.TryGetValue("en", out var n) ? n : string.Empty)
            .Where(n => !string.IsNullOrEmpty(n))
            .ToList() ?? new List<string>();

        var contentType = MapOriginalLanguageToType(attrs?.OriginalLanguage);

        return new SearchItem
        {
            Title = title,
            DetailUrl = $"https://mangadex.org/title/{mangaRel.Id}",
            Thumbnail = thumbnail,
            Type = contentType,
            Genre = string.Join(", ", genres),
            LatestChapterNumber = chapterNumber,
            LastUpdateText = chapter.Attributes.ReadableAt.ToTimeAgo(),
        };
    }

    /// <summary>Maps a manga search result (with cover_art relationship) to <see cref="SearchItem"/>.</summary>
    private static SearchItem MapMangaToSearchItem(MangaDexManga manga)
    {
        var attrs = manga.Attributes;
        var title = ResolveTitle(attrs.Title);

        // Cover art thumbnail
        var coverRel = manga.Relationships.FirstOrDefault(r => r.Type == "cover_art");
        var thumbnail = string.Empty;
        if (coverRel?.Attributes?.FileName != null)
            thumbnail = $"{CoverBaseUrl}/{manga.Id}/{coverRel.Attributes.FileName}.256.jpg";

        var genres = attrs.Tags
            .Select(t => t.Attributes.Name.TryGetValue("en", out var n) ? n : string.Empty)
            .Where(n => !string.IsNullOrEmpty(n))
            .ToList();

        var contentType = MapOriginalLanguageToType(attrs.OriginalLanguage);

        return new SearchItem
        {
            Title = title,
            DetailUrl = $"https://mangadex.org/title/{manga.Id}",
            Thumbnail = thumbnail,
            Type = contentType,
            Genre = string.Join(", ", genres),
            LatestChapterNumber = 0,    // Not available directly from search; enriched separately
            LastUpdateText = attrs.UpdatedAt.ToTimeAgo(),
        };
    }

    // â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private static string ResolveTitle(Dictionary<string, string>? titleMap)
    {
        if (titleMap == null || titleMap.Count == 0) return string.Empty;

        foreach (var lang in new[] { "en", "ja-ro", "ja", "ko-ro", "ko", "zh-ro" })
        {
            if (titleMap.TryGetValue(lang, out var t) && !string.IsNullOrWhiteSpace(t))
                return t;
        }

        return titleMap.Values.FirstOrDefault() ?? string.Empty;
    }

    private static string MapOriginalLanguageToType(string? lang) => lang switch
    {
        "ja" => "Manga",
        "ko" => "Manhwa",
        "zh" or "zh-hk" => "Manhua",
        _ => "Comic",
    };
}

