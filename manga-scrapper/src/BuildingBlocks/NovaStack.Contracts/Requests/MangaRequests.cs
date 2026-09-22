namespace NovaStack.Contracts.Requests;

public class MangaAdvancedFilter
{
    public string? Search { get; set; }
    public List<string>? IncludedGenres { get; set; }
    public string? GenreMatchMode { get; set; } = "And";
    public List<string>? ExcludedGenres { get; set; }
    public List<string>? Statuses { get; set; }
    public List<string>? Types { get; set; }
    public string? Author { get; set; }
    public double? MinRating { get; set; }
    public double? MaxRating { get; set; }
    public int? MinPopularity { get; set; }
    public int? MaxPopularity { get; set; }
    public int? MinTotalView { get; set; }
    public int? MaxTotalView { get; set; }
    public int? MinChapters { get; set; }
    public int? MaxChapters { get; set; }
    public DateTime? StartReleaseDate { get; set; }
    public DateTime? EndReleaseDate { get; set; }
    public bool? Nsfw { get; set; }
    public int? AnilistId { get; set; }
    public bool? UnlinkedAnilist { get; set; }
}

public class MangaSortOption
{
    public string Field { get; set; } = "updatedAt";
    public string Direction { get; set; } = "desc";
}

public class QueryPagedMangaRequest
{
    public MangaAdvancedFilter? Filter { get; set; }
    public List<MangaSortOption>? Sorts { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}
