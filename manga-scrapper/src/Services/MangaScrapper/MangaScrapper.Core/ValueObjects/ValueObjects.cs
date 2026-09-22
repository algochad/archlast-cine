namespace MangaScrapper.Core.ValueObjects;

public readonly record struct MangaId(Guid Value)
{
    public static MangaId New() => new(Guid.CreateVersion7());
    public static MangaId Empty => new(Guid.Empty);
    public static MangaId From(Guid value) => new(value);
    public override string ToString() => Value.ToString();
}

public readonly record struct ChapterId(Guid Value)
{
    public static ChapterId New() => new(Guid.CreateVersion7());
    public static ChapterId Empty => new(Guid.Empty);
    public static ChapterId From(Guid value) => new(value);
    public override string ToString() => Value.ToString();
}

public readonly record struct UserId(Guid Value)
{
    public static UserId New() => new(Guid.CreateVersion7());
    public static UserId Empty => new(Guid.Empty);
    public static UserId From(Guid value) => new(value);
    public override string ToString() => Value.ToString();
}

public enum MangaSource
{
    Komiku,
    Kiryuu,
    Komikcast,
    MangaDex
}

public enum MangaStatus
{
    Ongoing,
    Completed,
    Hiatus,
    Unknown
}
