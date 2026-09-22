namespace NovaStack.Contracts.Responses;

/// <summary>Paginated API response.</summary>
public sealed class PagedResponse<T>
{
    public IReadOnlyList<T> Items { get; init; } = [];
    public int Page { get; init; }
    public int PageSize { get; init; }
    public int TotalCount { get; init; }
    public int TotalPages => (int)Math.Ceiling(TotalCount / (double)PageSize);
    public bool HasPreviousPage => Page > 1;
    public bool HasNextPage => Page < TotalPages;

    public static PagedResponse<T> Create(
        IEnumerable<T> items,
        int page,
        int pageSize,
        int totalCount) =>
        new()
        {
            Items = items.ToList().AsReadOnly(),
            Page = page,
            PageSize = pageSize,
            TotalCount = totalCount
        };
}
