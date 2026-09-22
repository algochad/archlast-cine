using System.Globalization;
using System.Text.RegularExpressions;
using System.Web;
using FluentAssertions;
using HtmlAgilityPack;
using MangaScrapper.Core.Utils;
using Xunit;

namespace UnitTests.MangaScrapper;

public class ManhwadesuParsingTests
{
    private const string DetailHtml = @"
<div class=""main-info"">
<div class=""info-left"">
<div class=""info-left-margin"">	
<div class=""thumb"" itemprop=""image"" itemscope="""" itemtype=""https://schema.org/ImageObject""> <img src=""https://i1.wp.com/manhwadesu.wiki/wp-content/uploads/images/thumbs/my-landlady-noona/66dc915450b9a.jpg"" width=""720"" height=""1128"" class=""attachment- size- wp-post-image"" alt=""My Landlady Noona"" title=""My Landlady Noona"" itemprop=""image"" decoding=""async"" fetchpriority=""high""> <span class=""colored""><i class=""fas fa-palette""></i> Warna</span></div><div id=""mobiletitle""></div><div data-id=""15886"" class=""bookmark""><i class=""far fa-bookmark"" aria-hidden=""true""></i> Bookmark</div><div class=""bmc"">Followed by 7867 people</div><div class=""rating bixbox"">
<div class=""rating-prc"" itemscope=""itemscope"" itemprop=""aggregateRating"" itemtype=""//schema.org/AggregateRating"">
<meta itemprop=""worstRating"" content=""1"">
<meta itemprop=""bestRating"" content=""10"">
<meta itemprop=""ratingCount"" content=""10"">
<div class=""rtp"">
<div class=""rtb""><span style=""width:80%""></span></div></div><div class=""num"" itemprop=""ratingValue"" content=""8"">8</div></div></div><div class=""tsinfo bixbox"">
<div class=""imptdt""> Status <i>Completed</i></div><div class=""imptdt""> Type <a href=""https://manhwadesu.wiki/komik/?order=title&amp;type=Manhwa"">Manhwa</a></div><div class=""imptdt""> Released <i>2021</i></div><div class=""imptdt""> Author <i>Congee</i></div><div class=""imptdt""> Artist <i>Congee</i></div><div class=""imptdt""> Posted By <span itemprop=""author"" itemscope="""" itemtype=""https://schema.org/Person"" class=""author vcard""> <i itemprop=""name"">Manhwadesu</i> </span></div><div class=""imptdt""> Posted On <i><time itemprop=""datePublished"" datetime=""2024-04-18T06:22:02+07:00"">April 18, 2024</time></i></div><div class=""imptdt""> Updated On <i><time itemprop=""dateModified"" datetime=""2025-03-15T22:46:27+07:00"">Maret 15, 2025</time></i></div><div class=""imptdt""> Views <i><span class=""ts-views-count"">3.6M</span></i></div></div></div></div><div class=""info-right"">
<div class=""info-desc bixbox"">
<div id=""titledesktop""><div id=""titlemove""> <h1 class=""entry-title"" itemprop=""name"">My Landlady Noona</h1></div>
</div><div class=""wd-full""><span class=""mgen""><a href=""https://manhwadesu.wiki/genres/mature/"" rel=""tag"">Mature</a> <a href=""https://manhwadesu.wiki/genres/romance/"" rel=""tag"">Romance</a></span></div><div class=""wd-full"">
<h2>Sinopsis My Landlady Noona</h2>
<div class=""entry-content entry-content-single"" itemprop=""description""> <p>Hari yang baik dan cantik selalu menjaga Minwoo yang tinggal di rumahnya Bahkan Minwoo menyebut Hari sebagai bibi dan bahkan bukan kakak perempuan </p></div></div></div>
<div class=""bixbox bxcl epcheck"">
<div class=""releases""> <h2>Chapter My Landlady Noona</h2></div><div class=""search-chapter""> <input id=""searchchapter"" type=""text"" placeholder=""Cari Chapter. Contoh: 25 atau 178"" autocomplete=""off""></div><div class=""eplister"" id=""chapterlist""><ul class=""clstyle"">
<li data-num=""156""> <div class=""chbox""> <div class=""eph-num""> <a href=""https://manhwadesu.wiki/my-landlady-noona-chapter-156-end/""> <span class=""chapternum"">Chapter 156</span> <span class=""chapterdate"">Maret 15, 2025</span> </a></div></div></li>
<li data-num=""155""> <div class=""chbox""> <div class=""eph-num""> <a href=""https://manhwadesu.wiki/my-landlady-noona-chapter-155/""> <span class=""chapternum"">Chapter 155</span> <span class=""chapterdate"">Maret 8, 2025</span> </a></div></div></li>
<li data-num=""1""> <div class=""chbox""> <div class=""eph-num""> <a href=""https://manhwadesu.wiki/my-landlady-noona-chapter-1/""> <span class=""chapternum"">Chapter 1</span> <span class=""chapterdate"">April 18, 2024</span> </a></div></div></li>
</ul></div></div></div></div>";

    private const string ReaderHtml = @"
<div id=""readerarea""><img class=""ts-main-image"" data-index=""0"" src=""https://cdn.gilakomik.id/my-landlady-noona/chapter-1/images-1.webp"" data-server=""Server1"" onload=""ts_reader_control.singleImageOnload();"" onerror=""ts_reader_control.imageOnError();"" alt=""My Landlady Noona Chapter 1 page 0""><img class=""ts-main-image"" data-index=""1"" src=""https://cdn.gilakomik.id/my-landlady-noona/chapter-1/images-2.webp"" data-server=""Server1"" alt=""My Landlady Noona Chapter 1 page 1""></div>";

    private const string SearchHtml = @"
<div class=""listupd"">
    <div class=""bs"">
        <div class=""bsx"">
            <a href=""https://manhwadesu.wiki/komik/affair-agency/"" title=""Affair Agency"">
            <div class=""limit"">
                <div class=""ply""></div>
                <span class=""type Manhwa""></span>
                <span class=""colored""><i class=""fas fa-palette""></i> Warna</span>
                <img src=""https://i0.wp.com/manhwadesu.wiki/wp-content/uploads/images/thumbs/affair-agency/6a9259926d0b6.jpg?resize=165,225"" class=""ts-post-image wp-post-image attachment-medium size-medium"" loading=""lazy"" title=""Affair Agency"" alt=""Affair Agency"" width=""165"" height=""225"">
            </div>
            <div class=""bigor"">
                <div class=""tt"">Affair Agency</div>
                <div class=""adds"">
                    <div class=""epxs"">Chapter 13</div>
                    <div class=""rt"">
                        <div class=""rating"">
                            <div class=""rating-prc"">
                                <div class=""rtp""><div class=""rtb""><span style=""width:59%""></span></div></div>
                            </div>
                            <div class=""numscore"">5.9</div>
                        </div>
                    </div>
                </div>
            </div>
            </a>
        </div>
    </div>
</div>";

    [Fact]
    public void Should_Parse_Manhwadesu_Metadata()
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(DetailHtml);

        var title = HttpUtility.HtmlDecode(doc.DocumentNode.SelectSingleNode("//h1[@class='entry-title']")?.InnerText.Trim() ?? "");
        var author = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'tsinfo')]//div[contains(@class,'imptdt') and contains(.,'Author')]/i")?.InnerText.Trim() ?? "";
        var status = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'tsinfo')]//div[contains(@class,'imptdt') and contains(.,'Status')]/i")?.InnerText.Trim() ?? "";
        var type = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'tsinfo')]//div[contains(@class,'imptdt') and contains(.,'Type')]//a")?.InnerText.Trim() ?? "";
        var synopsis = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'entry-content')]/p")?.InnerText.Trim() ?? "";
        var genres = doc.DocumentNode.SelectNodes("//span[@class='mgen']/a")?.Select(g => g.InnerText.Trim()).ToList();
        var rating = doc.DocumentNode.SelectSingleNode("//div[@itemprop='ratingValue']")?.GetAttributeValue("content", "");
        var postedDateAttr = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'imptdt') and contains(.,'Posted On')]//time")?.GetAttributeValue("datetime", "");

        title.Should().Be("My Landlady Noona");
        author.Should().Be("Congee");
        status.Should().Be("Completed");
        type.Should().Be("Manhwa");
        synopsis.Should().Contain("Hari yang baik dan cantik selalu menjaga Minwoo");
        genres.Should().Contain(new[] { "Mature", "Romance" });
        rating.Should().Be("8");
        DateTimeOffset.TryParse(postedDateAttr, out var postedDate).Should().BeTrue();
        postedDate.Year.Should().Be(2024);
        postedDate.Month.Should().Be(4);
    }

    [Fact]
    public void Should_Parse_Manhwadesu_Chapters()
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(DetailHtml);

        var rows = doc.DocumentNode.SelectNodes("//div[@id='chapterlist']//ul/li");
        rows.Should().NotBeNull();
        rows.Count.Should().Be(3);

        var first = rows[0];
        var dataNum = first.GetAttributeValue("data-num", "");
        var link = first.SelectSingleNode(".//div[@class='eph-num']/a")?.GetAttributeValue("href", "");
        var chapterText = first.SelectSingleNode(".//div[@class='eph-num']/a/span[@class='chapternum']")?.InnerText.Trim();
        var dateText = first.SelectSingleNode(".//div[@class='eph-num']/a/span[@class='chapterdate']")?.InnerText.Trim();

        dataNum.Should().Be("156");
        link.Should().Be("https://manhwadesu.wiki/my-landlady-noona-chapter-156-end/");
        chapterText.Should().Be("Chapter 156");
        dateText.Should().Be("Maret 15, 2025");
    }

    [Fact]
    public void Should_Parse_Manhwadesu_Reader_Images()
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(ReaderHtml);

        var images = doc.DocumentNode.SelectNodes("//div[@id='readerarea']//img");
        images.Should().NotBeNull();
        images.Count.Should().Be(2);

        var firstSrc = images[0].GetAttributeValue("src", "");
        firstSrc.Should().Be("https://cdn.gilakomik.id/my-landlady-noona/chapter-1/images-1.webp");
    }

    [Fact]
    public void Should_Parse_Manhwadesu_Search_Cards()
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(SearchHtml);

        var card = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'bsx')]/a");
        card.Should().NotBeNull();

        var title = card.GetAttributeValue("title", "");
        var link = card.GetAttributeValue("href", "");
        var thumb = card.SelectSingleNode(".//img")?.GetAttributeValue("src", "");
        var rawThumb = ThumbnailHelper.RemoveQueryString(thumb);
        var latestChap = card.SelectSingleNode(".//div[@class='epxs']")?.InnerText.Trim();
        var score = card.SelectSingleNode(".//div[@class='numscore']")?.InnerText.Trim();

        title.Should().Be("Affair Agency");
        link.Should().Be("https://manhwadesu.wiki/komik/affair-agency/");
        rawThumb.Should().Be("https://i0.wp.com/manhwadesu.wiki/wp-content/uploads/images/thumbs/affair-agency/6a9259926d0b6.jpg");
        latestChap.Should().Be("Chapter 13");
        score.Should().Be("5.9");
    }

    [Fact]
    public void Should_Extract_Real_Image_When_Src_Is_Base64_Placeholder()
    {
        var html = @"
<div class=""thumb"" itemprop=""image"">
    <img src=""data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7""
         data-src=""https://i0.wp.com/manhwadesu.wiki/wp-content/uploads/images/thumbs/amoral-island-jou/69bd296e70abb.jpg""
         alt=""Amoral Island Jou"">
</div>";
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var thumbContainer = doc.DocumentNode.SelectSingleNode("//div[@itemprop='image']");
        var img = thumbContainer.SelectSingleNode(".//img");

        var url = ThumbnailHelper.ExtractImageUrl(img, thumbContainer);
        url.Should().Be("https://i0.wp.com/manhwadesu.wiki/wp-content/uploads/images/thumbs/amoral-island-jou/69bd296e70abb.jpg");
    }

    [Fact]
    public void Should_Extract_Real_Image_From_Data_Lazy_Src_Or_Srcset()
    {
        var html = @"
<div class=""thumb"">
    <img src=""data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7""
         data-lazy-src=""https://manhwadesu.wiki/wp-content/uploads/lazy.jpg""
         srcset=""https://manhwadesu.wiki/wp-content/uploads/lazy.jpg 1057w, https://manhwadesu.wiki/wp-content/uploads/lazy-300x426.jpg 300w"">
</div>";
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var thumbContainer = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'thumb')]");
        var img = thumbContainer.SelectSingleNode(".//img");

        var url = ThumbnailHelper.ExtractImageUrl(img, thumbContainer);
        url.Should().Be("https://manhwadesu.wiki/wp-content/uploads/lazy.jpg");
    }

    [Fact]
    public void Should_Extract_Real_Image_From_Noscript_Fallback()
    {
        var html = @"
<div class=""thumb"">
    <img src=""data:image/svg+xml..."" class=""lazyload"">
    <noscript>
        <img src=""https://manhwadesu.wiki/wp-content/uploads/noscript-fallback.jpg"">
    </noscript>
</div>";
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var thumbContainer = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'thumb')]");
        var img = thumbContainer.SelectSingleNode(".//img");

        var url = ThumbnailHelper.ExtractImageUrl(img, thumbContainer);
        url.Should().Be("https://manhwadesu.wiki/wp-content/uploads/noscript-fallback.jpg");
    }

    [Fact]
    public void Should_Parse_Views_Count_And_Distribute_To_Chapters()
    {
        var html = @"
<div class=""tsinfo bixbox"">
    <div class=""imptdt""> Views <i><span class=""ts-views-count"">174.3K</span></i></div>
</div>";
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var viewsNode = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'tsinfo')]//div[contains(@class,'imptdt') and contains(.,'Views')]//span[contains(@class,'ts-views-count')]");
        viewsNode.Should().NotBeNull();

        var totalViews = IntHelper.ParseCount(viewsNode!.InnerText.Trim());
        totalViews.Should().Be(174300);
    }

    [Fact]
    public void Should_Extract_PostId_From_Dynamic_Ajax_View_Script()
    {
        var html = @"
<div class=""tsinfo bixbox"">
    <div class=""imptdt""> Views <i><span class=""ts-views-count"">?</span></i></div>
</div>
<script>ts_dynamic_ajax_view(21713)
.then(function(resp){
if(! resp) return;
if(""views"" in resp===false) return;
var view_count_element=jQuery('.ts-views-count');
if(view_count_element.length) view_count_element.html(resp.views);
});</script>";
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var match = Regex.Match(doc.DocumentNode.OuterHtml, @"ts_dynamic_ajax_view\((\d+)\)");
        match.Success.Should().BeTrue();
        match.Groups[1].Value.Should().Be("21713");

        // Simulate JSON response from wp-admin/admin-ajax.php?action=ts_dynamic_ajax_view&post_id=21713
        var mockJson = "{\"views\":\"174.3K\"}";
        using var jsonDoc = System.Text.Json.JsonDocument.Parse(mockJson);
        var viewsStr = jsonDoc.RootElement.GetProperty("views").GetString();
        var totalViews = IntHelper.ParseCount(viewsStr ?? "");
        totalViews.Should().Be(174300);
    }
}
