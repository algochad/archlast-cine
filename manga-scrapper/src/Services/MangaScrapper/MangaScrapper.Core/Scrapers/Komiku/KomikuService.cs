using System.Globalization;
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

namespace MangaScrapper.Core.Scrapers.Komiku;

public class KomikuService : ScrapperServiceBase
{
    protected override string ProviderKey => "komiku";

    public KomikuService(
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
        LoadProvider("komiku-provider.json");
    }

    private HtmlDocument? doc;

    protected override Manga ExtractMangaMetadata(string url)
    {
        doc = GetHtml(url).GetAwaiter().GetResult();

        var title = HttpUtility.HtmlDecode(doc.DocumentNode.SelectSingleNode(Provider.MangaSelectors.Title)?.InnerText.Trim() ?? string.Empty);
        var author = doc.DocumentNode.SelectSingleNode(Provider.MangaSelectors.Author)?.InnerText.Trim() ?? string.Empty;
        var description = doc.DocumentNode.SelectSingleNode(Provider.MangaSelectors.Description)?.InnerText.Trim();
        var type = doc.DocumentNode.SelectSingleNode(Provider.MangaSelectors.Type)?.InnerText.Trim() ?? string.Empty;
        var imageUrl = doc.DocumentNode.SelectSingleNode(Provider.MangaSelectors.Thumbnail)?.GetAttributeValue("src", string.Empty);
        var genres = doc.DocumentNode.SelectNodes(Provider.MangaSelectors.Genres)?.Select(n => n.InnerText.Trim()).ToList();

        imageUrl = ThumbnailHelper.RemoveQueryString(imageUrl);

        if (string.IsNullOrEmpty(title))
        {
            title = HttpUtility.HtmlDecode(doc.DocumentNode.SelectSingleNode("//td[text()='Judul:']/following-sibling::td")?.InnerText.Trim() ?? string.Empty);
            author = doc.DocumentNode.SelectSingleNode("//td[text()='Author:']/following-sibling::td")?.InnerText.Trim() ?? string.Empty;
            type = doc.DocumentNode.SelectSingleNode("//td[text()='Tipe:']/following-sibling::td")?.InnerText.Trim() ?? string.Empty;
        }

        return Manga.Create(
            title: title,
            author: author,
            type: type,
            source: ProviderKey,
            genres: genres,
            description: description,
            imageUrl: imageUrl);
    }
    
    private static List<int> GenerateChapterViews(int totalViews, int chapterCount)
    {
        var rand = new Random();

        // Step 1: generate weight (awal lebih besar)
        var weights = new double[chapterCount];

        for (int i = 0; i < chapterCount; i++)
        {
            // contoh: decreasing weight
            var baseWeight = (chapterCount - i);

            // tambahin randomness biar ga terlalu linear
            weights[i] = baseWeight * (0.7 + rand.NextDouble() * 0.6);
        }

        var weightSum = weights.Sum();

        // Step 2: convert ke view
        var views = weights
            .Select(w => (int)Math.Floor(w / weightSum * totalViews))
            .ToList();

        // Step 3: fix rounding (biar total pas)
        var diff = totalViews - views.Sum();

        // distribute sisa ke random chapter
        for (int i = 0; i < diff; i++)
        {
            views[rand.Next(chapterCount)]++;
        }

        return views;
    }

    protected override async Task<List<Chapter>> ExtractChaptersMetadata(CancellationToken ct = default)
    {
        var chapters = new List<Chapter>();
        if (doc == null) return chapters;

        var chapterRows = doc.DocumentNode.SelectNodes(Provider.ChapterSelectors.Rows);
        if (chapterRows == null) return chapters;

        var total = 0;

        // Coba ekstrak total pembaca dari struktur baru:
        // <div class="viewskomik" hx-get="..." ...><section class="stats-card"><div class="stats-card__total"><p class="stats-card__figure">12.427</p>...
        var figureNode = doc.DocumentNode.SelectSingleNode("//div[contains(@class, 'stats-card__total')]//p[contains(@class, 'stats-card__figure')]")
                         ?? doc.DocumentNode.SelectSingleNode("//p[contains(@class, 'stats-card__figure')]");

        // Jika stats-card belum ada di dokumen (karena dimuat via hx-get), ambil dari URL hx-get jika ada
        if (figureNode == null)
        {
            var hxGet = doc.DocumentNode.SelectSingleNode("//div[contains(@class, 'viewskomik') and @hx-get]")
                ?.GetAttributeValue("hx-get", string.Empty);

            if (!string.IsNullOrWhiteSpace(hxGet))
            {
                try
                {
                    var viewsDoc = await GetHtml(HttpUtility.HtmlDecode(hxGet), ct: ct);
                    figureNode = viewsDoc.DocumentNode.SelectSingleNode("//div[contains(@class, 'stats-card__total')]//p[contains(@class, 'stats-card__figure')]")
                                 ?? viewsDoc.DocumentNode.SelectSingleNode("//p[contains(@class, 'stats-card__figure')]");
                }
                catch
                {
                    // Abaikan error jika pemanggilan views eksternal gagal
                }
            }
        }

        if (figureNode != null)
        {
            var totalMatch = Regex.Match(figureNode.InnerText.Trim(), @"[\d\.]+");
            var totalText = totalMatch.Value.Replace(".", "");
            if (int.TryParse(totalText, out var t))
            {
                total = t;
            }
        }

        // Fallback ke format lama jika tidak ditemukan
        if (total == 0)
        {
            var dViews =
                HttpUtility.HtmlDecode(doc.DocumentNode.SelectSingleNode("//td[text()='Pembaca:']/following-sibling::td")?.InnerText.Trim() ??
                                       string.Empty);
            var totalMatch = Regex.Match(dViews, @"Total:\s*([\d\.]+)");
            var totalText = totalMatch.Groups[1].Value.Replace(".", "");
            if (int.TryParse(totalText, out var t))
            {
                total = t;
            }
        }

        var viewsGenerated = GenerateChapterViews(total, chapterRows.Count);
        var index = chapterRows.Count - 1;

        foreach (var row in chapterRows)
        {
            var link = row.SelectSingleNode(Provider.ChapterSelectors.Link)?.GetAttributeValue("href", string.Empty);
            var chapterText = row.SelectSingleNode(Provider.ChapterSelectors.ChapterText)?.InnerText.Trim();
            var viewText = row.SelectSingleNode(Provider.ChapterSelectors.Views)?.InnerText.Trim();
            var dateText = row.SelectSingleNode(Provider.ChapterSelectors.UploadDate)?.InnerText.Trim();

            if (string.IsNullOrWhiteSpace(link) || chapterText == null) continue;

            var chapterNumberText = Regex.Match(chapterText.Replace("Chapter ", "", StringComparison.OrdinalIgnoreCase), @"\d+(\.\d+)?").Value;
            var chapterNumber = double.TryParse(chapterNumberText, NumberStyles.Float, CultureInfo.InvariantCulture, out var num) ? num : 0;
            var totalView = int.TryParse(viewText, out var view) ? view : 0;
            var uploadDate = DateTime.TryParseExact(dateText, "dd/MM/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
                ? date
                : DateTime.MinValue;

            if (totalView == 0)
            {
                totalView = viewsGenerated[index];
                index--;
            }

            chapters.Add(new Chapter(
                id: ChapterId.New(),
                number: chapterNumber,
                link: link,
                chapterProvider: Provider.ProviderName,
                chapterProviderIcon: Provider.ProviderIcon,
                language: DefaultIndonesianLanguage,
                totalView: totalView,
                uploadDate: uploadDate));
        }

        return chapters;
    }

    public override async Task<List<SearchItem>> SearchManga(SearchRequest request, CancellationToken ct)
    {
        var url = $"https://api.komiku.org/manga/page/{request.Page}/?orderby=modified&tipe={request.Type ?? ""}&genre={request.Genres?.FirstOrDefault() ?? ""}&genre2&status={request.Status ?? ""}";
        if (!string.IsNullOrEmpty(request.Keyword))
        {
            url = $"https://api.komiku.org/?post_type=manga&s={HttpUtility.UrlEncode(request.Keyword)}";
        }
        var doc = await GetHtml(url, ct: ct);

        var results = new List<SearchItem>();

        var nodes = doc.DocumentNode.SelectNodes("//div[@class='bge']");
        if (nodes == null) return results;

        foreach (var node in nodes)
        {
            try
            {
                var item = new SearchItem();

                var titleNode = node.SelectSingleNode(".//div[@class='kan']//h3");
                var linkNode = node.SelectSingleNode(".//div[@class='kan']//a[1]");

                item.Title = HttpUtility.HtmlDecode(titleNode?.InnerText.Trim());
                item.DetailUrl = linkNode?.GetAttributeValue("href", "") ?? "";
                if (!string.IsNullOrEmpty(request.Keyword))
                {
                    item.DetailUrl = Provider.BaseUrl+item.DetailUrl;
                }

                var imgNode = node.SelectSingleNode(".//div[@class='bgei']//img");
                var thumbnail = imgNode?.GetAttributeValue("src", "") ?? "";
                if (thumbnail.Contains('?'))
                {
                    thumbnail = thumbnail.Split('?')[0];
                }
                item.Thumbnail = thumbnail;

                var typeNode = node.SelectSingleNode(".//div[contains(@class,'tpe1_inf')]/b");
                var genreNode = node.SelectSingleNode(".//div[contains(@class,'tpe1_inf')]");

                item.Type = typeNode?.InnerText.Trim() ?? "";

                if (genreNode != null)
                {
                    var genreText = HtmlEntity.DeEntitize(genreNode.InnerText)
                        .Replace(item.Type, "")
                        .Trim();
                    item.Genre = genreText;
                }

                var infoNode = node.SelectSingleNode(".//div[@class='kan']//span[contains(@class,'judul2')]");
                if (infoNode != null)
                {
                    var text = HtmlEntity.DeEntitize(infoNode.InnerText);
                    var parts = text.Split('|', StringSplitOptions.TrimEntries);
                    if (parts.Length >= 2)
                    {
                        item.LastUpdateText = parts[1];
                    }
                }
                else
                {
                    item.LastUpdateText = node.SelectSingleNode(".//div[@class='kan']/p")?.InnerText.Trim();
                }

                var latestNode = node.SelectSingleNode(".//div[@class='new1'][2]//span[last()]");
                if (latestNode != null)
                {
                    var match = Regex.Match(latestNode.InnerText, @"([\d\.]+)");
                    if (match.Success &&
                        double.TryParse(match.Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var chap))
                    {
                        item.LatestChapterNumber = chap;
                    }
                }

                results.Add(item);
            }
            catch
            {
                // skip item error biar tidak crash
            }
        }

        await Task.WhenAll(results.Select(item => EnrichSearchItemAsync(item, ct)));

        return results;
    }

    public static string ResolveImageUrl(string src, string? onError = null)
    {
        if (string.IsNullOrWhiteSpace(src)) return string.Empty;

        var transformed = src.Trim();
        if (transformed.StartsWith("//", StringComparison.OrdinalIgnoreCase))
        {
            transformed = "https:" + transformed;
        }

        if (!string.IsNullOrWhiteSpace(onError))
        {
            var replaceMatch = Regex.Match(onError, @"replace\(\s*['""]([^'""]+)['""]\s*,\s*['""]([^'""]+)['""]\s*\)");
            if (replaceMatch.Success)
            {
                var oldVal = replaceMatch.Groups[1].Value;
                var newVal = replaceMatch.Groups[2].Value;
                transformed = transformed.Replace(oldVal, newVal);
            }
        }

        // Komiku images on dead image*.komiku.to subdomains should fallback to img.komiku.org
        transformed = Regex.Replace(transformed, @"image\d+\.komiku\.to", "img.komiku.org", RegexOptions.IgnoreCase);
        return transformed;
    }

    public static bool IsChapterImage(string src)
    {
        if (string.IsNullOrWhiteSpace(src)) return false;
        return !src.Contains("promosi", StringComparison.OrdinalIgnoreCase) &&
               !src.Contains("banner", StringComparison.OrdinalIgnoreCase) &&
               !src.Contains("iklan", StringComparison.OrdinalIgnoreCase);
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
        var imageNodes = chapterDoc.DocumentNode.SelectNodes(Provider.PageSelectors.Images);
        if (imageNodes == null) return chapter;

        var chapterImages = new List<(string OriginalUrl, string TransformedUrl)>();
        foreach (var imgNode in imageNodes)
        {
            var src = imgNode.GetAttributeValue("src", string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(src)) continue;

            if (src.StartsWith("//", StringComparison.OrdinalIgnoreCase))
            {
                src = "https:" + src;
            }
            else if (src.StartsWith("/", StringComparison.OrdinalIgnoreCase))
            {
                src = Provider.BaseUrl.TrimEnd('/') + src;
            }

            if (!IsChapterImage(src)) continue;

            var onError = imgNode.GetAttributeValue("onerror", string.Empty);
            var transformed = ResolveImageUrl(src, onError);

            chapterImages.Add((src, transformed));
        }

        if (chapterImages.Count == 0) return chapter;

        var total = chapterImages.Count;
        var completed = 0;
        if (onProgress != null && total > 0)
        {
            await onProgress(0, total);
        }

        var downloadTasks = chapterImages.Select(async (imgInfo, index) =>
        {
            var primaryUrl = imgInfo.TransformedUrl;
            var fallbackUrl = imgInfo.OriginalUrl;

            await Semaphore.WaitAsync(ct);
            try
            {
                var result = await DownloadAndConvertToWebP(
                    mangaTitle,
                    chapter.Number.ToString(CultureInfo.InvariantCulture),
                    primaryUrl,
                    index + 1,
                    ct);

                // If primary download failed and produced a fallback broken image, try original URL if different
                if (result.isFallback && !string.Equals(primaryUrl, fallbackUrl, StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        var retryResult = await DownloadAndConvertToWebP(
                            mangaTitle,
                            chapter.Number.ToString(CultureInfo.InvariantCulture),
                            fallbackUrl,
                            index + 1,
                            ct);

                        if (!retryResult.isFallback)
                        {
                            result = retryResult;
                            primaryUrl = fallbackUrl;
                        }
                    }
                    catch
                    {
                        // Keep primary result if retry also fails
                    }
                }

                var current = Interlocked.Increment(ref completed);
                if (onProgress != null)
                {
                    await onProgress(current, total);
                }

                return (Index: index, Page: new Page(Guid.CreateVersion7(), primaryUrl, result.path, result.size, result.width, result.height, result.isFallback));
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Failed to download/convert image at index {Index} for {MangaTitle} (Komiku)", index, mangaTitle);
                throw;
            }
            finally
            {
                Semaphore.Release();
            }
        });

        var results = await Task.WhenAll(downloadTasks);
        chapter.AddPages(results.OrderBy(r => r.Index).Where(r => r.Page != null).Select(r => r.Page!).ToList());
        return chapter;
    }
}


