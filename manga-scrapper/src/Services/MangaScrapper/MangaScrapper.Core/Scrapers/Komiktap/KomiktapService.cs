using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Web;
using HtmlAgilityPack;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.Utils;
using MangaScrapper.Core.ValueObjects;
using NovaStack.Infrastructure.Messaging;

namespace MangaScrapper.Core.Scrapers.Komiktap;

public class KomiktapService : ScrapperServiceBase
{
    protected override string ProviderKey => "komiktap";

    public KomiktapService(
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
        LoadProvider("komiktap-provider.json");
    }

    private HtmlDocument? doc;

    protected override Manga ExtractMangaMetadata(string url)
    {
        doc = GetHtml(url).GetAwaiter().GetResult();

        var title = HttpUtility.HtmlDecode(
            doc.DocumentNode.SelectSingleNode(Provider.MangaSelectors.Title)?.InnerText.Trim() ?? string.Empty);

        var author = doc.DocumentNode
            .SelectSingleNode(Provider.MangaSelectors.Author)?.InnerText.Trim() ?? string.Empty;

        var description = doc.DocumentNode
            .SelectSingleNode(Provider.MangaSelectors.Description)?.InnerText.Trim();

        var type = doc.DocumentNode
            .SelectSingleNode(Provider.MangaSelectors.Type)?.InnerText.Trim() ?? string.Empty;

        var status = doc.DocumentNode
            .SelectSingleNode(Provider.MangaSelectors.Status)?.InnerText.Trim() ?? "Ongoing";

        var imageUrl = doc.DocumentNode
            .SelectSingleNode(Provider.MangaSelectors.Thumbnail)?.GetAttributeValue("src", string.Empty);

        // Posted On: ambil dari attribute datetime pada <time> di baris "Posted On"
        DateTime? releaseDate = null;
        var releaseDateAttr = doc.DocumentNode
            .SelectSingleNode("//table[@class='infotable']//td[text()='Posted On']/following-sibling::td//time")
            ?.GetAttributeValue("datetime", null);
        if (!string.IsNullOrEmpty(releaseDateAttr) &&
            DateTimeOffset.TryParse(releaseDateAttr, out var parsedRelease))
        {
            releaseDate = parsedRelease.UtcDateTime;
        }

        var genreNodes = doc.DocumentNode.SelectNodes(Provider.MangaSelectors.Genres);
        var genres = genreNodes?.Select(n => HttpUtility.HtmlDecode(n.InnerText.Trim())).ToList();

        // Parse rating from aggregateRating
        double? rating = null;
        var ratingNode = doc.DocumentNode.SelectSingleNode("//div[@itemprop='ratingValue']");
        var ratingText = ratingNode?.GetAttributeValue("content", string.Empty)
                         ?? ratingNode?.InnerText.Trim();
        if (!string.IsNullOrEmpty(ratingText) &&
            double.TryParse(ratingText, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedRating))
        {
            rating = parsedRating;
        }

        imageUrl = ThumbnailHelper.RemoveQueryString(imageUrl);

        return Manga.Create(
            title: title,
            author: author,
            type: type,
            source: ProviderKey,
            genres: genres,
            description: description,
            imageUrl: imageUrl,
            rating: rating,
            status: status,
            releaseDate: releaseDate,
            nsfw: true);
    }

    protected override Task<List<Chapter>> ExtractChaptersMetadata(CancellationToken ct = default)
    {
        var chapters = new List<Chapter>();
        var chapterRows = doc!.DocumentNode.SelectNodes(Provider.ChapterSelectors.Rows);
        if (chapterRows == null) return Task.FromResult(chapters);

        foreach (var row in chapterRows)
        {
            var linkNode = row.SelectSingleNode(Provider.ChapterSelectors.Link);
            var link = linkNode?.GetAttributeValue("href", string.Empty);
            if (string.IsNullOrWhiteSpace(link)) continue;

            var chapterText = row.SelectSingleNode(Provider.ChapterSelectors.ChapterText)?.InnerText.Trim();
            var dateText = row.SelectSingleNode(Provider.ChapterSelectors.UploadDate)?.InnerText.Trim();

            // Parse chapter number (e.g. "Chapter 144", "Chapter 124 - End S4")
            var chapterNumberText = Regex.Match(
                chapterText?.Replace("Chapter ", "", StringComparison.OrdinalIgnoreCase) ?? "",
                @"\d+(\.\d+)?").Value;
            var chapterNumber = double.TryParse(
                chapterNumberText, NumberStyles.Float, CultureInfo.InvariantCulture, out var num) ? num : 0;

            // Parse upload date (format from site: "Februari 1, 2023" — Indonesian locale)
            var uploadDate = ParseIndonesianDate(dateText);

            chapters.Add(new Chapter(
                id: ChapterId.New(),
                number: chapterNumber,
                link: link,
                chapterProvider: Provider.ProviderName,
                chapterProviderIcon: Provider.ProviderIcon,
                language: DefaultIndonesianLanguage,
                totalView: 0,
                uploadDate: uploadDate));
        }

        return Task.FromResult(chapters);
    }

    /// <summary>
    /// Parses Indonesian month names used by Komiktap (e.g. "Februari 1, 2023").
    /// Falls back to <see cref="DateTime.MinValue"/> when parsing fails.
    /// </summary>
    private static DateTime ParseIndonesianDate(string? dateText)
    {
        if (string.IsNullOrWhiteSpace(dateText)) return DateTime.MinValue;

        var normalized = dateText
            .Replace("Januari", "January")
            .Replace("Februari", "February")
            .Replace("Maret", "March")
            .Replace("April", "April")
            .Replace("Mei", "May")
            .Replace("Juni", "June")
            .Replace("Juli", "July")
            .Replace("Agustus", "August")
            .Replace("September", "September")
            .Replace("Oktober", "October")
            .Replace("November", "November")
            .Replace("Desember", "December");

        return DateTime.TryParse(normalized, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : DateTime.MinValue;
    }

    public override async Task<Chapter> GetChapterPage(
        string mangaTitle,
        Chapter chapter,
        CancellationToken ct = default,
        Func<int, int, Task>? onProgress = null)
    {
        var url = chapter.Link;
        if (string.IsNullOrWhiteSpace(url)) return chapter;
        if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            url = Provider.BaseUrl.TrimEnd('/') + "/" + url.TrimStart('/');

        var doc = await GetHtml(url, ct: ct);
        var imageUrls = new List<string>();

        // 1. Coba ambil dari static <img> tag jika ada
        var imageNodes = doc.DocumentNode.SelectNodes(Provider.PageSelectors.Images);
        if (imageNodes != null && imageNodes.Count > 0)
        {
            foreach (var node in imageNodes)
            {
                var src = node.GetAttributeValue("src", string.Empty);
                if (!string.IsNullOrWhiteSpace(src))
                {
                    imageUrls.Add(src);
                }
            }
        }

        // 2. Jika tidak ada <img> tag di static HTML, ekstrak dari JavaScript ts_reader.run({...})
        if (imageUrls.Count == 0)
        {
            var scriptNodes = doc.DocumentNode.SelectNodes("//script");
            if (scriptNodes != null)
            {
                foreach (var script in scriptNodes)
                {
                    var text = script.InnerText;
                    if (string.IsNullOrEmpty(text) || !text.Contains("ts_reader.run")) continue;

                    var match = Regex.Match(text, @"ts_reader\.run\((?<json>\{.+?\})\);", RegexOptions.Singleline);
                    if (match.Success)
                    {
                        try
                        {
                            using var jsonDoc = JsonDocument.Parse(match.Groups["json"].Value);
                            if (jsonDoc.RootElement.TryGetProperty("sources", out var sourcesElement) &&
                                sourcesElement.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var source in sourcesElement.EnumerateArray())
                                {
                                    if (source.TryGetProperty("images", out var imagesElement) &&
                                        imagesElement.ValueKind == JsonValueKind.Array)
                                    {
                                        foreach (var img in imagesElement.EnumerateArray())
                                        {
                                            var imgUrl = img.GetString();
                                            if (!string.IsNullOrWhiteSpace(imgUrl))
                                            {
                                                imageUrls.Add(imgUrl.Trim());
                                            }
                                        }
                                        if (imageUrls.Count > 0) break;
                                    }
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            Logger.LogWarning(ex, "Failed to parse ts_reader.run JSON for chapter at {Url}", url);
                        }
                    }
                }
            }
        }

        if (imageUrls.Count == 0) return chapter;

        var total = imageUrls.Count;
        var completed = 0;
        if (onProgress != null && total > 0)
        {
            await onProgress(0, total);
        }

        var downloadTasks = imageUrls.Select(async (imageUrl, index) =>
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
                Logger.LogError(ex, "Failed to download/convert image at index {Index} for {MangaTitle} (Komiktap)", index, mangaTitle);
                throw;
            }
            finally
            {
                Semaphore.Release();
            }
        });

        var results = await Task.WhenAll(downloadTasks);
        var pages = results.OrderBy(r => r.Index).Where(r => r.Page != null).Select(r => r.Page!).ToList();
        chapter.AddPages(pages);
        return chapter;
    }

    public override async Task<List<SearchItem>> SearchManga(SearchRequest request, CancellationToken ct)
    {
        var baseUrl = Provider.BaseUrl.TrimEnd('/');
        string url;

        if (!string.IsNullOrEmpty(request.Keyword))
        {
            // Search endpoint: https://komiktap.info/page/1/?s=<keyword>
            var page = request.Page > 1 ? $"page/{request.Page}/" : string.Empty;
            url = $"{baseUrl}/{page}?s={HttpUtility.UrlEncode(request.Keyword)}";
        }
        else if (!string.IsNullOrEmpty(request.Type))
        {
            url = $"{baseUrl}/manga/?page={request.Page}&type={HttpUtility.UrlEncode(request.Type)}&order=update";
        }
        else
        {
            // Browse / filter endpoint: https://komiktap.info/page/1/?s (empty search = latest)
            url = $"{baseUrl}/manga/?page={request.Page}&type=&order=update";
        }

        var searchDoc = await GetHtml(url, ct: ct);
        var results = new List<SearchItem>();

        // Cards: div.bs > div.bsx > a
        var cards = searchDoc.DocumentNode.SelectNodes("//div[contains(@class,'bsx')]/a");
        if (cards == null) return results;

        foreach (var card in cards)
        {
            try
            {
                var detailUrl = card.GetAttributeValue("href", string.Empty);
                var titleText = HttpUtility.HtmlDecode(card.GetAttributeValue("title", string.Empty).Trim());

                if (string.IsNullOrWhiteSpace(titleText))
                    titleText = HttpUtility.HtmlDecode(card.SelectSingleNode(".//div[@class='tt']")?.InnerText.Trim() ?? string.Empty);

                var thumbnail = card.SelectSingleNode(".//img")?.GetAttributeValue("src", string.Empty);

                // Latest chapter number
                var latestChapterText = card.SelectSingleNode(".//div[@class='epxs']")?.InnerText.Trim();
                var chapterNumberText = Regex.Match(
                    latestChapterText?.Replace("Chapter ", "", StringComparison.OrdinalIgnoreCase) ?? "",
                    @"\d+(\.\d+)?").Value;
                var chapterNumber = double.TryParse(
                    chapterNumberText, NumberStyles.Float, CultureInfo.InvariantCulture, out var num) ? num : 0;

                // Rating
                var ratingText = card.SelectSingleNode(".//div[@class='numscore']")?.InnerText.Trim();

                var item = new SearchItem
                {
                    Title = titleText,
                    DetailUrl = detailUrl,
                    Thumbnail = ThumbnailHelper.RemoveQueryString(thumbnail) ?? string.Empty,
                    LatestChapterNumber = chapterNumber,
                    LastUpdateText = ratingText
                };

                results.Add(item);
            }
            catch
            {
                // skip malformed card
            }
        }

        await Task.WhenAll(results.Select(item => EnrichSearchItemAsync(item, ct)));

        return results;
    }
}
