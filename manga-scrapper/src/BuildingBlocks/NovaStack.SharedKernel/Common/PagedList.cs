namespace NovaStack.SharedKernel.Common;

/// <summary>Represents a paginated list of items.</summary>
public sealed class PagedList<T>
{
    public IReadOnlyList<T> Items { get; }
    public int Page { get; }
    public int PageSize { get; }
    public int TotalCount { get; }
    public int TotalPages => (int)Math.Ceiling(TotalCount / (double)PageSize);
    public bool HasPreviousPage => Page > 1;
    public bool HasNextPage => Page < TotalPages;

    public PagedList(IEnumerable<T> items, int page, int pageSize, int totalCount)
    {
        Items = items.ToList().AsReadOnly();
        Page = page;
        PageSize = pageSize;
        TotalCount = totalCount;
    }

    public static PagedList<T> Create(IQueryable<T> source, int page, int pageSize)
    {
        var total = source.Count();
        var items = source.Skip((page - 1) * pageSize).Take(pageSize);
        return new PagedList<T>(items, page, pageSize, total);
    }

    public PagedList<TOut> Map<TOut>(Func<T, TOut> mapper) =>
        new(Items.Select(mapper), Page, PageSize, TotalCount);
}
