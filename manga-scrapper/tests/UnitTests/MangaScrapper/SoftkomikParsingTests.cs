using System.Text.Json;
using MangaScrapper.Core.Scrapers.Softkomik;
using Xunit;

namespace UnitTests.MangaScrapper;

public class SoftkomikParsingTests
{
    [Fact]
    public void Should_Deserialize_NextData_Manga_Detail()
    {
        var json = """
        {
            "props": {
                "pageProps": {
                    "data": {
                        "_id": "69d20b049ce632f01ae061c0",
                        "title": "I Wanna Be U",
                        "title_alt": "Your Throne",
                        "sinopsis": "Sinopsis cerita...",
                        "author": "Sam",
                        "status": "ongoing",
                        "type": "manhwa",
                        "gambar": "image-cover-2/i-wanna-be-u.jpeg",
                        "latest_chapter": "250",
                        "title_slug": "i-wanna-be-u-bahasa-indonesia",
                        "Genre": ["Drama", "Fantasy"],
                        "rating": {
                            "value": 4.75,
                            "member": 20
                        }
                    }
                }
            }
        }
        """;

        var wrapper = JsonSerializer.Deserialize<SoftkomikNextDataWrapper<SoftkomikDetailPageProps>>(
            json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        Assert.NotNull(wrapper?.Props?.PageProps?.Data);
        var data = wrapper.Props.PageProps.Data;
        Assert.Equal("I Wanna Be U", data.Title);
        Assert.Equal("Your Throne", data.TitleAlt);
        Assert.Equal("ongoing", data.Status);
        Assert.Equal("manhwa", data.Type);
        Assert.Equal(2, data.Genre?.Count);
        Assert.Equal(4.75, data.Rating?.Value);
    }

    [Fact]
    public void Should_Deserialize_Chapter_List()
    {
        var json = """
        {
            "title": "I Wanna Be U",
            "chapter": [
                { "chapter": "250" },
                { "chapter": "249" }
            ]
        }
        """;

        var res = JsonSerializer.Deserialize<SoftkomikChapterListResponse>(
            json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        Assert.NotNull(res);
        Assert.Equal(2, res.Chapter.Count);
        Assert.Equal("250", res.Chapter[0].Chapter);
    }

    [Fact]
    public void Should_Deserialize_Search_Response()
    {
        var json = """
        {
            "page": 1,
            "maxPage": 1,
            "data": [
                {
                    "_id": "69d20b049ce632f01ae061c0",
                    "title": "I Wanna Be U",
                    "status": "ongoing",
                    "type": "manhwa",
                    "gambar": "image-cover-2/i-wanna-be-u.jpeg",
                    "latest_chapter": "250",
                    "title_slug": "i-wanna-be-u-bahasa-indonesia"
                }
            ]
        }
        """;

        var res = JsonSerializer.Deserialize<SoftkomikSearchResponse>(
            json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        Assert.NotNull(res);
        Assert.Single(res.Data);
        Assert.Equal("I Wanna Be U", res.Data[0].Title);
        Assert.Equal("i-wanna-be-u-bahasa-indonesia", res.Data[0].TitleSlug);
    }
}
