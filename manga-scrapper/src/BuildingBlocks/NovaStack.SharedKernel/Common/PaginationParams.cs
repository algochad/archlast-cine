namespace NovaStack.SharedKernel.Common;

/// <summary>Pagination query parameters.</summary>
public record PaginationParams
{
    private const int MaxPageSize = 100;
    private const int DefaultPageSize = 10;

    private int _pageSize = DefaultPageSize;
    private int _page = 1;

    public int Page
    {
        get => _page;
        init => _page = value < 1 ? 1 : value;
    }

    public int PageSize
    {
        get => _pageSize;
        init => _pageSize = value > MaxPageSize ? MaxPageSize : value < 1 ? DefaultPageSize : value;
    }

    public string? SortBy { get; init; }
    public bool Descending { get; init; }
    public string? Search { get; init; }
}
