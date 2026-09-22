namespace MangaScrapper.Core.Scrapers.Komikcast;

public class KomikcastModel
{
    public long Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public KomikcastDataSeries Data { get; set; } = new();
    public KomikcastStatMeta DataMetadata { get; set; } = new();
    public List<KomikcastChapters> Chapters { get; set; } = new();
}

public class KomikcastResponse<T>
{
    public int Status { get; set; }
    public T? Data { get; set; }
    public KomicastMeta? Meta { get; set; }
}

public class KomicastMeta
{
    public long Total { get; set; }
    public long Page { get; set; }
    public long LastPage { get; set; }
}

public class KomikcastStatMeta
{
    public long Ranking { get; set; }
    public long TotalViewsComputed { get; set; }
}

public class KomikcastDataSeries
{
    public string Slug { get; set; } = string.Empty;
    public string Title { get; set; }= string.Empty;
    public string Author { get; set; }= string.Empty;
    public string Format { get; set; }= string.Empty;
    public double Rating { get; set; }
    public string Status { get; set; }= string.Empty;
    public string Synopsis { get; set; }= string.Empty;
    public string CoverImage { get; set; }= string.Empty;
    public List<KomikcastGenres> Genres { get; set; } = new();
}

public class KomikcastGenres{
public int Id { get; set; }
public KomikcastDataGenre Data { get; set; } = new();
}

public class KomikcastDataGenre
{
    public string Name { get; set; } = string.Empty;
}

public class KomikcastChapters
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public KomikcastChapterData Data { get; set; } = new();
    public double? ChapterIndex { get; set; }
    public KomikcastChapterStats? Views { get; set; }

}

public class KomikcastChapterData
{
    public double Index { get; set; }
}

public class KomikcastChapterStats
{
    public int Analytics { get; set; }
    public int History { get; set; }
    public int Total { get; set; }
}

public class KomikcastChapterDetails
{
    public long Id { get; set; }
    public KomikcastChapterDetailsData Data { get; set; } = new();
    public double ChapterIndex { get; set; }
}

public class KomikcastChapterDetailsData
{
    public string? Slug { get; set; }
    public string? Title { get; set; }
    public List<string> Images { get; set; } = new();
}
