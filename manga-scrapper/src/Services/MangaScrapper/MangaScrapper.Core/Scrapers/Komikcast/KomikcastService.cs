using System.Globalization;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.Utils;
using MangaScrapper.Core.ValueObjects;
using Microsoft.AspNetCore.WebUtilities;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Scrapers.Komikcast;

public class KomikcastService : ScrapperServiceBase
{
    protected override string ProviderKey => "komikcast";

    public KomikcastService(
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
        LoadProvider("komikcast-provider.json");
    }

    private const string BaseUrl = "https://be.komikcast.cc/series";
    private string _fullUrl = BaseUrl + "/";

    protected override Manga ExtractMangaMetadata(string url)
    {
        _fullUrl = url.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? url
            : $"{BaseUrl}/{url.TrimStart('/')}";
        var seriesData = GetFromJsonAsync<KomikcastResponse<KomikcastModel>>(_fullUrl).GetAwaiter().GetResult();

        return Manga.Create(
            title: seriesData.Data.Data.Title,
            author: seriesData.Data.Data.Author,
            type: CultureInfo.CurrentCulture.TextInfo.ToTitleCase(seriesData.Data.Data.Format),
            source: ProviderKey,
            genres: seriesData.Data.Data.Genres.Select(x => x.Data.Name).ToList(),
            description: seriesData.Data.Data.Synopsis,
            imageUrl: seriesData.Data.Data.CoverImage,
            rating: seriesData.Data.Data.Rating,
            status: CultureInfo.CurrentCulture.TextInfo.ToTitleCase(seriesData.Data.Data.Status));
    }

    protected override async Task<List<Chapter>> ExtractChaptersMetadata(CancellationToken ct = default)
    {
        var chaptersUrl = _fullUrl.EndsWith("/chapters") ? _fullUrl : $"{_fullUrl}/chapters";
        var chapterData = await GetFromJsonAsync<KomikcastResponse<List<KomikcastChapters>>>(chaptersUrl, cancellationToken: ct);
        var chapters = new List<Chapter>();
        foreach (var item in chapterData.Data)
        {
            chapters.Add(new Chapter(
                id: ChapterId.New(),
                number: item.Data.Index,
                link: $"{chaptersUrl}/{item.Data.Index}",
                chapterProvider: Provider.ProviderName,
                chapterProviderIcon: Provider.ProviderIcon,
                language: DefaultIndonesianLanguage,
                totalView: item.Views?.Total ?? 0,
                uploadDate: item.CreatedAt));
        }
        return chapters;
    }

    public override async Task<Chapter> GetChapterPage(string mangaTitle, Chapter chapter, CancellationToken ct = default, Func<int, int, Task>? onProgress = null)
    {
        var url = chapter.Link;
        if (string.IsNullOrWhiteSpace(url)) return chapter;

        var response = await GetFromJsonAsync<KomikcastResponse<KomikcastChapterDetails>>(url, cancellationToken: ct);
        if (response?.Data?.Data?.Images == null)
        {
            return chapter;
        }

        var images = response.Data.Data.Images;
        var total = images.Count;
        var completed = 0;
        if (onProgress != null && total > 0)
        {
            await onProgress(0, total);
        }

        var downloadTasks = images.Select(async (imageUrl, index) =>
        {
            if (string.IsNullOrWhiteSpace(imageUrl)) return (Index: index, Page: null as Page);

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
                Logger.LogError(ex, "Failed to download/convert image at index {Index} for {MangaTitle} (Komikcast)", index, mangaTitle);
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

        var queryParams = new List<KeyValuePair<string, string?>>
        {
            new("takeChapter", "1"),
            new("includeMeta", "true"),
            new("sort", "latest"),
            new("sortOrder", "desc"),
            new("take", "12"),
            new("page", request.Page.ToString())
        };
        if (!string.IsNullOrEmpty(request.Keyword))
        {
            queryParams.Add(new("filter", $"title=like=\"{request.Keyword}\",nativeTitle=like=\"{request.Keyword}\""));
        }
        if (request.Genres != null && request.Genres.Count > 0)
        {
            foreach (var genre in request.Genres)
            {
                queryParams.Add(new("genreIds", genre));
            }
        }

        var fullUrl = QueryHelpers.AddQueryString(BaseUrl, queryParams);

        var data = await GetFromJsonAsync<KomikcastResponse<List<KomikcastModel>>>(fullUrl, cancellationToken: ct);

        var resp = new List<SearchItem>();

        foreach (var item in data.Data)
        {
            var sItem = new SearchItem();
            sItem.Title = item.Data.Title;
            sItem.LatestChapterNumber = item.Chapters.First().ChapterIndex ?? 0;
            sItem.Thumbnail = item.Data.CoverImage;
            sItem.DetailUrl = item.Data.Slug;
            sItem.Type = CultureInfo.CurrentCulture.TextInfo.ToTitleCase(item.Data.Format);
            sItem.Genre = string.Join(",", item.Data.Genres.Select(x => x.Data.Name));
            sItem.LastUpdateText = item.Chapters.First().CreatedAt.ToTimeAgo();

            await EnrichSearchItemAsync(sItem, ct);
            resp.Add(sItem);
        }
        return resp;
    }
}


