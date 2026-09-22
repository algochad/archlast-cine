using System.Text.Json.Serialization;

namespace MangaScrapper.Core.Scrapers.Softkomik;

public class SoftkomikSessionResponse
{
    [JsonPropertyName("token")]
    public string Token { get; set; } = string.Empty;

    [JsonPropertyName("sign")]
    public string Sign { get; set; } = string.Empty;

    [JsonPropertyName("ex")]
    public long Ex { get; set; }
}

public class SoftkomikNextDataWrapper<T>
{
    [JsonPropertyName("props")]
    public SoftkomikProps<T>? Props { get; set; }
}

public class SoftkomikProps<T>
{
    [JsonPropertyName("pageProps")]
    public T? PageProps { get; set; }
}

public class SoftkomikDetailPageProps
{
    [JsonPropertyName("data")]
    public SoftkomikMangaDetail? Data { get; set; }
}

public class SoftkomikMangaDetail
{
    [JsonPropertyName("_id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("title_alt")]
    public string? TitleAlt { get; set; }

    [JsonPropertyName("sinopsis")]
    public string? Sinopsis { get; set; }

    [JsonPropertyName("author")]
    public string? Author { get; set; }

    [JsonPropertyName("tahun")]
    public string? Tahun { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("gambar")]
    public string? Gambar { get; set; }

    [JsonPropertyName("latest_chapter")]
    public string? LatestChapter { get; set; }

    [JsonPropertyName("title_slug")]
    public string? TitleSlug { get; set; }

    [JsonPropertyName("Genre")]
    public List<string>? Genre { get; set; }

    [JsonPropertyName("rating")]
    public SoftkomikRating? Rating { get; set; }
}

public class SoftkomikRating
{
    [JsonPropertyName("value")]
    public double Value { get; set; }

    [JsonPropertyName("member")]
    public int Member { get; set; }
}

public class SoftkomikChapterListResponse
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("chapter")]
    public List<SoftkomikChapterItem> Chapter { get; set; } = [];
}

public class SoftkomikChapterItem
{
    [JsonPropertyName("chapter")]
    public string Chapter { get; set; } = string.Empty;
}

public class SoftkomikChapterPageProps
{
    [JsonPropertyName("data")]
    public SoftkomikChapterPageData? Data { get; set; }
}

public class SoftkomikChapterPageData
{
    [JsonPropertyName("chapter")]
    public string? Chapter { get; set; }

    [JsonPropertyName("komik")]
    public SoftkomikKomikRef? Komik { get; set; }

    [JsonPropertyName("data")]
    public SoftkomikChapterDoc? Data { get; set; }

    [JsonPropertyName("imageSrc")]
    public List<string>? ImageSrc { get; set; }
}

public class SoftkomikKomikRef
{
    [JsonPropertyName("title_slug")]
    public string? TitleSlug { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }
}

public class SoftkomikChapterDoc
{
    [JsonPropertyName("_id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("storageInter2")]
    public bool? StorageInter2 { get; set; }

    [JsonPropertyName("backBS3")]
    public bool? BackBS3 { get; set; }
}

public class SoftkomikChapterImgsResponse
{
    [JsonPropertyName("imageSrc")]
    public List<string> ImageSrc { get; set; } = [];
}

public class SoftkomikSearchResponse
{
    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("maxPage")]
    public int MaxPage { get; set; }

    [JsonPropertyName("data")]
    public List<SoftkomikSearchItem> Data { get; set; } = [];
}

public class SoftkomikSearchItem
{
    [JsonPropertyName("_id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("gambar")]
    public string? Gambar { get; set; }

    [JsonPropertyName("latest_chapter")]
    public string? LatestChapter { get; set; }

    [JsonPropertyName("title_slug")]
    public string? TitleSlug { get; set; }
}
