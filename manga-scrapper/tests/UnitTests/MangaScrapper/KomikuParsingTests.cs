using HtmlAgilityPack;
using MangaScrapper.Core.Scrapers.Komiku;
using Xunit;

namespace UnitTests.MangaScrapper;

public class KomikuParsingTests
{
    [Theory]
    [InlineData("https://image2.komiku.to/komiku-promosi.webp", false)]
    [InlineData("https://komiku.org/assets/banner-iklan.jpg", false)]
    [InlineData("https://image2.komiku.to/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/1.webp", true)]
    [InlineData("https://img.komiku.org/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/7.webp", true)]
    [InlineData("https://image2.komiku.to/uploads2/2793755-1.jpg", true)]
    public void IsChapterImage_ShouldFilterPromotionsAndAds(string url, bool expected)
    {
        var result = KomikuService.IsChapterImage(url);
        Assert.Equal(expected, result);
    }

    [Fact]
    public void ResolveImageUrl_ShouldReplaceFromOnErrorAttribute()
    {
        var src = "https://image3.komiku.to/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/7.webp";
        var onError = "if(!this.dataset.f){this.dataset.f=1;this.src=this.src.replace('image3.komiku.to','img.komiku.org')}";

        var resolved = KomikuService.ResolveImageUrl(src, onError);

        Assert.Equal("https://img.komiku.org/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/7.webp", resolved);
    }

    [Fact]
    public void ResolveImageUrl_ShouldFallbackReplaceDeadImageToDomains()
    {
        var src = "https://image4.komiku.to/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/12.webp";

        var resolved = KomikuService.ResolveImageUrl(src, null);

        Assert.Equal("https://img.komiku.org/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/12.webp", resolved);
    }

    [Fact]
    public void ResolveImageUrl_ShouldKeepAlreadyCorrectImgKomikuOrg()
    {
        var src = "https://img.komiku.org/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/67.webp";

        var resolved = KomikuService.ResolveImageUrl(src, null);

        Assert.Equal("https://img.komiku.org/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/67.webp", resolved);
    }

    [Fact]
    public void ReaderHtml_ShouldExtractOnlyChapterPagesAndResolveOnerror()
    {
        var html = """
        <div id="Baca_Komik" onclick="klik('body')">
        <h2 class="judulbaca">Baca Online</h2>
        <div class="iklan mobile"></div>
        <img src="https://image2.komiku.to/komiku-promosi.webp">
        <img src="https://image2.komiku.to/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/1.webp" alt="Komik The Extra’s Academy Survival Guide Chapter 124 gambar 1" class="klazy ww" id="1" onerror="if(!this.dataset.f){this.dataset.f=1;this.src=this.src.replace('image2.komiku.to','img.komiku.org')}">
        <img src="https://image3.komiku.to/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/7.webp" alt="The Extra’s Academy Survival Guide Chapter 124 Gambar 7" class="ww" id="7" onerror="if(!this.dataset.f){this.dataset.f=1;this.src=this.src.replace('image3.komiku.to','img.komiku.org')}" data-f="1">
        <img src="https://img.komiku.org/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/67.webp" alt="The Extra’s Academy Survival Guide Chapter 124 Gambar 67" class="ww" id="67">
        <div class="iklan mobile"></div>
        </div>
        """;

        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var imageNodes = doc.DocumentNode.SelectNodes("//div[@id='Baca_Komik']//img[@src]");
        Assert.NotNull(imageNodes);

        var chapterImages = new List<string>();
        foreach (var imgNode in imageNodes)
        {
            var src = imgNode.GetAttributeValue("src", string.Empty).Trim();
            if (!KomikuService.IsChapterImage(src)) continue;

            var onError = imgNode.GetAttributeValue("onerror", string.Empty);
            var resolved = KomikuService.ResolveImageUrl(src, onError);
            chapterImages.Add(resolved);
        }

        Assert.Equal(3, chapterImages.Count);
        Assert.Equal("https://img.komiku.org/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/1.webp", chapterImages[0]);
        Assert.Equal("https://img.komiku.org/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/7.webp", chapterImages[1]);
        Assert.Equal("https://img.komiku.org/upload5/the-extra-s-academy-survival-guide/124/2026-09-18/67.webp", chapterImages[2]);
    }
}
