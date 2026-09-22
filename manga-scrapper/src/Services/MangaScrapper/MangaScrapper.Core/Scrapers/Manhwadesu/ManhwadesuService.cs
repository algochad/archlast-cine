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

namespace MangaScrapper.Core.Scrapers.Manhwadesu;

public class ManhwadesuService : ScrapperServiceBase
{
    protected override string ProviderKey => "manhwadesu";

    public ManhwadesuService(
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
        LoadProvider("manhwadesu-provider.json");
    }

    private HtmlDocument? doc;

    protected override Manga ExtractMangaMetadata(string url)
    {
        doc = GetHtml(url).GetAwaiter().GetResult();

        var title = HttpUtility.HtmlDecode(
            doc.DocumentNode.SelectSingleNode(Provider.MangaSelectors.Title)?.InnerText.Trim()
            ?? doc.DocumentNode.SelectSingleNode("//h1[@itemprop='name']")?.InnerText.Trim()
            ?? string.Empty);

        var author = doc.DocumentNode
            .SelectSingleNode(Provider.MangaSelectors.Author)?.InnerText.Trim()
            ?? doc.DocumentNode.SelectSingleNode("//div[contains(@class,'imptdt') and contains(.,'Author')]//i")?.InnerText.Trim()
            ?? string.Empty;

        var description = doc.DocumentNode
            .SelectSingleNode(Provider.MangaSelectors.Description)?.InnerText.Trim()
            ?? doc.DocumentNode.SelectSingleNode("//div[@itemprop='description']")?.InnerText.Trim();

        var type = doc.DocumentNode
            .SelectSingleNode(Provider.MangaSelectors.Type)?.InnerText.Trim()
            ?? doc.DocumentNode.SelectSingleNode("//div[contains(@class,'imptdt') and contains(.,'Type')]//a")?.InnerText.Trim()
            ?? string.Empty;

        var status = doc.DocumentNode
            .SelectSingleNode(Provider.MangaSelectors.Status)?.InnerText.Trim()
            ?? doc.DocumentNode.SelectSingleNode("//div[contains(@class,'imptdt') and contains(.,'Status')]//i")?.InnerText.Trim()
            ?? "Ongoing";

        var thumbContainer = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'thumb')]")
                             ?? doc.DocumentNode.SelectSingleNode("//div[@itemprop='image']");
        var imgNode = doc.DocumentNode.SelectSingleNode(Provider.MangaSelectors.Thumbnail)
                      ?? thumbContainer?.SelectSingleNode(".//img");

        var imageUrl = ThumbnailHelper.ExtractImageUrl(imgNode, thumbContainer);

        // Posted On: parse datetime attribute from <time> tag
        DateTime? releaseDate = null;
        var releaseDateAttr = doc.DocumentNode
            .SelectSingleNode("//div[contains(@class,'imptdt') and contains(.,'Posted On')]//time")
            ?.GetAttributeValue("datetime", string.Empty);

        if (!string.IsNullOrEmpty(releaseDateAttr) &&
            DateTimeOffset.TryParse(releaseDateAttr, out var parsedRelease))
        {
            releaseDate = parsedRelease.UtcDateTime;
        }

        var genreNodes = doc.DocumentNode.SelectNodes(Provider.MangaSelectors.Genres);
        var genres = genreNodes?.Select(n => HttpUtility.HtmlDecode(n.InnerText.Trim())).ToList();

        // Parse rating from aggregateRating / ratingValue
        double? rating = null;
        var ratingNode = doc.DocumentNode.SelectSingleNode("//div[@itemprop='ratingValue']")
                         ?? doc.DocumentNode.SelectSingleNode("//div[contains(@class,'rating-prc')]//div[contains(@class,'num')]");
        var ratingText = ratingNode?.GetAttributeValue("content", string.Empty);
        if (string.IsNullOrWhiteSpace(ratingText))
        {
            ratingText = ratingNode?.InnerText.Trim();
        }

        if (!string.IsNullOrEmpty(ratingText) &&
            double.TryParse(ratingText, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedRating))
        {
            rating = parsedRating;
        }

        imageUrl = ThumbnailHelper.RemoveQueryString(imageUrl);

        var isNsfw = true; // Manhwadesu is an 18+ manhwa portal

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
            nsfw: isNsfw);
    }

    private static List<int> GenerateChapterViews(int totalViews, int chapterCount)
    {
        if (totalViews <= 0 || chapterCount <= 0)
            return Enumerable.Repeat(0, Math.Max(0, chapterCount)).ToList();

        var rand = new Random();

        // Step 1: generate weight (chapter awal lebih besar)
        var weights = new double[chapterCount];

        for (int i = 0; i < chapterCount; i++)
        {
            var baseWeight = (chapterCount - i);
            weights[i] = baseWeight * (0.7 + rand.NextDouble() * 0.6);
        }

        var weightSum = weights.Sum();

        // Step 2: convert ke view
        var views = weights
            .Select(w => (int)Math.Floor(w / weightSum * totalViews))
            .ToList();

        // Step 3: fix rounding (biar total pas)
        var diff = totalViews - views.Sum();

        for (int i = 0; i < diff; i++)
        {
            views[rand.Next(chapterCount)]++;
        }

        return views;
    }

    private async Task<int> FetchDynamicTotalViewsAsync(CancellationToken ct = default)
    {
        var viewsNode = doc!.DocumentNode.SelectSingleNode("//div[contains(@class,'tsinfo')]//div[contains(@class,'imptdt') and contains(.,'Views')]//span[contains(@class,'ts-views-count')]")
                        ?? doc.DocumentNode.SelectSingleNode("//span[contains(@class,'ts-views-count')]")
                        ?? doc.DocumentNode.SelectSingleNode("//div[contains(@class,'tsinfo')]//div[contains(@class,'imptdt') and contains(.,'Views')]//i");
        var viewsText = viewsNode?.InnerText.Trim();

        // If viewsText is already a valid count and not '?' or placeholder
        if (!string.IsNullOrWhiteSpace(viewsText) && !viewsText.Contains('?'))
        {
            var count = IntHelper.ParseCount(viewsText);
            if (count > 0) return count;
        }

        // Extract post ID from script ts_dynamic_ajax_view(ID) or data-id attribute
        var outerHtml = doc.DocumentNode.OuterHtml;
        var match = Regex.Match(outerHtml, @"ts_dynamic_ajax_view\((\d+)\)");
        var postId = match.Success ? match.Groups[1].Value : null;

        if (string.IsNullOrEmpty(postId))
        {
            var bookmarkNode = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'bookmark') and @data-id]");
            postId = bookmarkNode?.GetAttributeValue("data-id", string.Empty);
        }

        if (string.IsNullOrEmpty(postId))
        {
            var shortlink = doc.DocumentNode.SelectSingleNode("//link[@rel='shortlink']")?.GetAttributeValue("href", string.Empty);
            if (!string.IsNullOrEmpty(shortlink))
            {
                var pMatch = Regex.Match(shortlink, @"\?p=(\d+)");
                if (pMatch.Success) postId = pMatch.Groups[1].Value;
            }
        }

        if (!string.IsNullOrEmpty(postId))
        {
            var baseUrl = Provider.BaseUrl.TrimEnd('/');
            var ajaxUrl = $"{baseUrl}/wp-admin/admin-ajax.php";

            try
            {
                var parameters = new List<KeyValuePair<string, string>>
                {
                    new("action", "dynamic_view_ajax"),
                    new("post_id", postId)
                };
                using var formData = new FormUrlEncodedContent(parameters);

                var ajaxDoc = await GetHtml(ajaxUrl, formData: formData, ct: ct);
                var rawText = ajaxDoc.DocumentNode.InnerText.Trim();

                if (!string.IsNullOrEmpty(rawText) && (rawText.StartsWith('{') || rawText.Contains("views")))
                {
                    using var jsonDoc = JsonDocument.Parse(rawText);
                    if (jsonDoc.RootElement.TryGetProperty("views", out var viewsProp))
                    {
                        var viewsString = viewsProp.ValueKind == JsonValueKind.Number
                            ? viewsProp.GetInt64().ToString(CultureInfo.InvariantCulture)
                            : viewsProp.GetString();

                        if (!string.IsNullOrWhiteSpace(viewsString))
                        {
                            var parsed = IntHelper.ParseCount(viewsString);
                            if (parsed > 0) return parsed;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.LogDebug(ex, "Failed to fetch dynamic views for post {PostId} via admin-ajax", postId);
            }
        }

        return 0;
    }

    protected override async Task<List<Chapter>> ExtractChaptersMetadata(CancellationToken ct = default)
    {
        var chapters = new List<Chapter>();
        var chapterRows = doc!.DocumentNode.SelectNodes(Provider.ChapterSelectors.Rows);
        if (chapterRows == null) return chapters;

        var totalViews = await FetchDynamicTotalViewsAsync(ct);
        var viewsGenerated = GenerateChapterViews(totalViews, chapterRows.Count);
        var index = chapterRows.Count - 1;

        foreach (var row in chapterRows)
        {
            var linkNode = row.SelectSingleNode(Provider.ChapterSelectors.Link);
            var link = linkNode?.GetAttributeValue("href", string.Empty);
            if (string.IsNullOrWhiteSpace(link)) continue;

            var chapterText = row.SelectSingleNode(Provider.ChapterSelectors.ChapterText)?.InnerText.Trim();
            var dateText = row.SelectSingleNode(Provider.ChapterSelectors.UploadDate)?.InnerText.Trim();

            // First attempt: read from data-num attribute (e.g. data-num="156")
            var dataNum = row.GetAttributeValue("data-num", string.Empty);
            double chapterNumber = 0;
            if (!string.IsNullOrWhiteSpace(dataNum) &&
                double.TryParse(dataNum, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedDataNum))
            {
                chapterNumber = parsedDataNum;
            }
            else
            {
                // Fallback: parse from chapter text (e.g. "Chapter 156", "Chapter 137 - End")
                var chapterNumberText = Regex.Match(
                    chapterText?.Replace("Chapter ", "", StringComparison.OrdinalIgnoreCase) ?? "",
                    @"\d+(\.\d+)?").Value;

                if (double.TryParse(chapterNumberText, NumberStyles.Float, CultureInfo.InvariantCulture, out var num))
                {
                    chapterNumber = num;
                }
            }

            var uploadDate = ParseIndonesianDate(dateText);

            var chapterView = 0;
            if (viewsGenerated.Count > 0 && index >= 0 && index < viewsGenerated.Count)
            {
                chapterView = viewsGenerated[index];
                index--;
            }

            chapters.Add(new Chapter(
                id: ChapterId.New(),
                number: chapterNumber,
                link: link,
                chapterProvider: Provider.ProviderName,
                chapterProviderIcon: Provider.ProviderIcon,
                language: DefaultIndonesianLanguage,
                totalView: chapterView,
                uploadDate: uploadDate));
        }

        return chapters;
    }

    /// <summary>
    /// Parses Indonesian month names used by Manhwadesu (e.g. "Maret 15, 2025", "April 18, 2024").
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

        var chapterDoc = await GetHtml(url, ct: ct);
        var imageUrls = new List<string>();

        // 1. Extract from static <img> tags in #readerarea
        var imageNodes = chapterDoc.DocumentNode.SelectNodes(Provider.PageSelectors.Images);
        if (imageNodes != null && imageNodes.Count > 0)
        {
            foreach (var node in imageNodes)
            {
                var src = ThumbnailHelper.ExtractImageUrl(node);
                if (!string.IsNullOrWhiteSpace(src) && !src.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    imageUrls.Add(src.Trim());
                }
            }
        }

        // 2. Fallback: extract from JavaScript ts_reader.run({...})
        if (imageUrls.Count == 0)
        {
            var scriptNodes = chapterDoc.DocumentNode.SelectNodes("//script");
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
                Logger.LogError(ex, "Failed to download/convert image at index {Index} for {MangaTitle} (Manhwadesu)", index, mangaTitle);
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
            // Search query endpoint: https://manhwadesu.wiki/?s=<keyword> or /page/<page>/?s=<keyword>
            var page = request.Page > 1 ? $"page/{request.Page}/" : string.Empty;
            url = $"{baseUrl}/{page}?s={HttpUtility.UrlEncode(request.Keyword)}";
        }
        else if (!string.IsNullOrEmpty(request.Type))
        {
            url = $"{baseUrl}/komik/?page={request.Page}&type={HttpUtility.UrlEncode(request.Type)}&order=update";
        }
        else
        {
            // Default latest browse endpoint: https://manhwadesu.wiki/komik/?type=manhwa&order=update
            var page = request.Page > 1 ? $"?page={request.Page}" : string.Empty;
            url = $"{baseUrl}/komik/?page={request.Page}&order=update";
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

                var imgNode = card.SelectSingleNode(".//img");
                var thumbContainer = card.SelectSingleNode(".//div[contains(@class,'limit')]") ?? card;
                var thumbnail = ThumbnailHelper.ExtractImageUrl(imgNode, thumbContainer);

                // Latest chapter number
                var latestChapterText = card.SelectSingleNode(".//div[@class='epxs']")?.InnerText.Trim();
                var chapterNumberText = Regex.Match(
                    latestChapterText?.Replace("Chapter ", "", StringComparison.OrdinalIgnoreCase) ?? "",
                    @"\d+(\.\d+)?").Value;

                var chapterNumber = double.TryParse(
                    chapterNumberText, NumberStyles.Float, CultureInfo.InvariantCulture, out var num) ? num : 0;

                // Rating / Score
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
