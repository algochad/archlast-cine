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

namespace MangaScrapper.Core.Scrapers.Kiryuu;

public class KiryuuService : ScrapperServiceBase
{
    protected override string ProviderKey => "kiryuu";

    public KiryuuService(
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
        LoadProvider("kiryuu-provider.json");
    }

    private HtmlDocument? doc;

    protected override Manga ExtractMangaMetadata(string url)
    {
        doc = GetHtml(url).GetAwaiter().GetResult();

        var title = HttpUtility.HtmlDecode(doc.DocumentNode.SelectSingleNode("//h1[@itemprop='name']")?.InnerText.Trim() ?? string.Empty);
        var imageUrl = doc.DocumentNode.SelectSingleNode("//div[@itemprop='image']//img")?.GetAttributeValue("src", "")?.Trim();
        var description = doc.DocumentNode.SelectSingleNode("//div[@itemprop='description']")?.InnerText.Trim();

        double? rating = null;
        var rate = doc.DocumentNode.SelectSingleNode("//small[normalize-space()='Ratings']/preceding-sibling::span[1]/text()")?.InnerText.Trim();
        if (!string.IsNullOrEmpty(rate) && double.TryParse(rate, CultureInfo.InvariantCulture, out var parsedRate))
            rating = parsedRate;

        List<string>? genres = null;
        var genreNodes = doc.DocumentNode.SelectNodes("//a[@itemprop='genre']/span");
        if (genreNodes != null)
        {
            genres = genreNodes.Select(g => g.InnerText.Trim()).ToList();
        }

        string type = string.Empty;
        var typeNode = doc.DocumentNode.SelectSingleNode(
            "//h4/span[normalize-space()='Type']/ancestor::div[contains(@class,'flex')][1]//p"
        );
        if (typeNode != null)
        {
            type = typeNode.InnerText.Trim();
        }

        string status = "Ongoing";
        string author = string.Empty;

        var infoNodes = doc.DocumentNode.SelectNodes("//div[contains(@class,'grid')]//h4");
        if (infoNodes != null)
        {
            foreach (var node in infoNodes)
            {
                var label = node.InnerText.Trim();
                var value = node.ParentNode.SelectSingleNode(".//p")?.InnerText.Trim();

                if (label.Contains("Author")) author = value ?? string.Empty;
                if (label.Contains("Status")) status = value ?? "Ongoing";
            }
        }

        return Manga.Create(
            title: title,
            author: author,
            type: type,
            source: ProviderKey,
            genres: genres,
            description: description,
            imageUrl: imageUrl,
            rating: rating,
            status: status);
    }

    protected override async Task<List<Chapter>> ExtractChaptersMetadata(CancellationToken ct = default)
    {
        var hxNode = doc.DocumentNode.SelectSingleNode("//div[contains(@hx-get,'manga_id=')]");
        var hxGet = hxNode?.GetAttributeValue("hx-get", "");
        var match = Regex.Match(hxGet ?? "", @"manga_id=(\d+)");
        var mangaId = match.Success ? int.Parse(match.Groups[1].Value) : 0;

        if (mangaId == 0) return new List<Chapter>();

        var data = new List<Chapter>();
        var cUrl = $"{Provider.BaseUrl}/wp-admin/admin-ajax.php?manga_id={mangaId}&page=1&action=chapter_list";
        var chaptersDoc = await GetHtml(cUrl, ct: ct);

        var chapterNodes = chaptersDoc.DocumentNode.SelectNodes(Provider.ChapterSelectors.Rows);
        if (chapterNodes == null) return data;

        foreach (var node in chapterNodes)
        {
            var number = node.GetAttributeValue("data-chapter-number", 0d);
            var link = node.SelectSingleNode(".//a")?.GetAttributeValue("href", string.Empty);
            var time = node.SelectSingleNode(".//time")?.GetAttributeValue("datetime", "");
            var views = node.SelectSingleNode(Provider.ChapterSelectors.Views)?.InnerText.Trim();

            if (string.IsNullOrWhiteSpace(link)) continue;

            var uri = new Uri(link);
            var path = uri.PathAndQuery;

            data.Add(new Chapter(
                id: ChapterId.New(),
                number: number,
                link: path,
                chapterProvider: Provider.ProviderName,
                chapterProviderIcon: Provider.ProviderIcon,
                language: DefaultIndonesianLanguage,
                totalView: IntHelper.ParseCount(views ?? string.Empty),
                uploadDate: DateTime.TryParse(time, out var parsedDate) ? parsedDate : DateTime.MinValue));
        }

        return data;
    }

    public override async Task<List<SearchItem>> SearchManga(SearchRequest request, CancellationToken ct)
    {
        var baseUrlClean = Provider.BaseUrl.TrimEnd('/');
        var url = $"{baseUrlClean}/wp-admin/admin-ajax.php?action=advanced_search";
        var parameters = new List<KeyValuePair<string, string>>();

        if (!string.IsNullOrEmpty(request.Keyword))
            parameters.Add(new KeyValuePair<string, string>("query", request.Keyword));

        if (!string.IsNullOrEmpty(request.Status))
        {
            var statuses = new List<string> { request.Status };
            parameters.Add(new KeyValuePair<string, string>("status", JsonSerializer.Serialize(statuses)));
        }

        if (!string.IsNullOrEmpty(request.Type))
        {
            var types = new List<string> { request.Type };
            parameters.Add(new KeyValuePair<string, string>("type", JsonSerializer.Serialize(types)));
        }

        parameters.Add(new KeyValuePair<string, string>("orderby", "updated"));
        parameters.Add(new KeyValuePair<string, string>("page", request.Page.ToString()));

        if (request.Genres != null && request.Genres.Any())
        {
            var genresJson = JsonSerializer.Serialize(request.Genres);
            parameters.Add(new KeyValuePair<string, string>("genre", genresJson));
        }

        using var formData = new FormUrlEncodedContent(parameters);
        var doc = await GetHtml(url, null, formData, ct: ct);
        var data = new List<SearchItem>();

        var cards = doc.DocumentNode.SelectNodes("//div[div[contains(@class,'rounded-lg')] and div[contains(@class,'group-data-[mode=horizontal]')]]");

        if (cards != null)
        {
            foreach (var card in cards)
            {
                var titleNode = card.SelectSingleNode(".//div[contains(@class,'rounded-lg')]//a[contains(@class,'line-clamp-1')]");
                var title = HttpUtility.HtmlDecode(titleNode?.InnerText.Trim());
                var link = titleNode?.GetAttributeValue("href", "");
                var thumb = card.SelectSingleNode(".//div[contains(@class,'rounded-lg')]//img")?.GetAttributeValue("src", "");
                var chapter = card.SelectSingleNode(".//span[contains(text(),'Chapter')]")?.InnerText.Trim();

                var chapterNumberText = Regex.Match(chapter?.Replace("Chapter ", "", StringComparison.OrdinalIgnoreCase) ?? "", @"\d+(\.\d+)?").Value;
                var chapterNumber = double.TryParse(chapterNumberText, NumberStyles.Float, CultureInfo.InvariantCulture, out var num) ? num : 0;

                var timeNode = card.SelectSingleNode(".//div[contains(@class,'group-data-[mode=horizontal]')]//a[1]//time");
                var latestTimeText = timeNode?.InnerText.Trim();

                var item = new SearchItem
                {
                    Title = title,
                    DetailUrl = link,
                    Thumbnail = thumb,
                    LatestChapterNumber = chapterNumber,
                    LastUpdateText = latestTimeText
                };

                data.Add(item);
            }
        }

        await Task.WhenAll(data.Select(item => EnrichSearchItemAsync(item, ct)));

        return data;
    }
}


