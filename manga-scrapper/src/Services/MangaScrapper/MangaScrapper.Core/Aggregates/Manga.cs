using MangaScrapper.Core.DomainEvents;
using MangaScrapper.Core.ValueObjects;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Common;

namespace MangaScrapper.Core.Aggregates;

public class Chapter
{
    public ChapterId Id { get; private set; }
    public double Number { get; private set; }
    public string? Link { get; private set; }
    public string? ChapterProvider { get; private set; }
    public string? ChapterProviderIcon { get; private set; }
    public string Language { get; private set; }
    public int TotalView { get; private set; }
    public DateTime UploadDate { get; private set; }
    private List<Page> _pages = [];
    public List<Page> Pages
    {
        get => _pages ??= [];
        private set => _pages = value ?? [];
    }

    public bool HasBrokenPages => Pages.Any(p => p.IsFallback);
    public int BrokenPageCount => Pages.Count(p => p.IsFallback);

    public Chapter(
        ChapterId id,
        double number,
        string? link,
        string? chapterProvider,
        string? chapterProviderIcon,
        string language,
        int totalView,
        DateTime uploadDate,
        List<Page>? pages = null)
    {
        Id = id;
        Number = number;
        Link = link;
        ChapterProvider = chapterProvider;
        ChapterProviderIcon = chapterProviderIcon;
        Language = language;
        TotalView = totalView;
        UploadDate = uploadDate;
        Pages = pages ?? [];
    }

    public void AddPages(List<Page> pages) => Pages.AddRange(pages);
    public void AddPage(Page page) => Pages.Add(page);
    public void IncrementView() => TotalView++;
    public void UpdateTotalView(int totalView)
    {
        if (totalView > TotalView) TotalView = totalView;
    }
}

public class Page
{
    public Guid Id { get; private set; }
    public string ImageUrl { get; private set; }
    public string? LocalImageUrl { get; private set; }
    public long Size { get; private set; }
    public int Width { get; private set; }
    public int Height { get; private set; }
    public bool IsFallback { get; private set; }

    public Page(Guid id, string imageUrl, string? localImageUrl = null, long size = 0, int width = 0, int height = 0, bool isFallback = false)
    {
        Id = id;
        ImageUrl = imageUrl;
        LocalImageUrl = localImageUrl;
        Size = size;
        Width = width;
        Height = height;
        IsFallback = isFallback;
    }

    public void UpdateLocalImage(string localImageUrl, long size, int? width = null, int? height = null, bool? isFallback = null)
    {
        LocalImageUrl = localImageUrl;
        Size = size;
        if (width.HasValue) Width = width.Value;
        if (height.HasValue) Height = height.Value;
        if (isFallback.HasValue) IsFallback = isFallback.Value;
    }

    public void UpdateDimension(int width, int height)
    {
        Width = width;
        Height = height;
    }

    public void MarkAsFallback(bool isFallback = true)
    {
        IsFallback = isFallback;
    }

    public void UpdateLocalImageUrl(string localImageUrl)
    {
        LocalImageUrl = localImageUrl;
    }
}

public class Manga : Entity<MangaId>
{
    public int MalId { get; private set; }
    public int? AnilistId { get; private set; }
    public long? MangaUpdateId { get; private set; }
    public string Title { get; private set; }
    private List<string> _synonyms = [];
    public List<string> Synonyms
    {
        get => _synonyms ??= [];
        private set => _synonyms = value ?? [];
    }
    public string Author { get; private set; }
    public string Type { get; private set; }
    public double? Rating { get; private set; }
    public int Popularity { get; private set; }
    public int Members { get; private set; }
    private List<string> _genres = [];
    public List<string> Genres
    {
        get => _genres ??= [];
        private set => _genres = value ?? [];
    }
    private List<string> _categories = [];
    public List<string> Categories
    {
        get => _categories ??= [];
        private set => _categories = value ?? [];
    }
    public string? Description { get; private set; }
    public string? ImageUrl { get; private set; }
    public string? LocalImageUrl { get; private set; }
    public long ThumbnailSize { get; private set; }
    public bool Nsfw { get; private set; }
    public string? Status { get; private set; }
    public DateTime? ReleaseDate { get; private set; }
    public int TotalView { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }
    public string? Url { get; private set; }
    private List<Chapter> _chapters = [];
    public List<Chapter> Chapters
    {
        get => _chapters ??= [];
        private set => _chapters = value ?? [];
    }

    private Manga(
        MangaId id,
        string title,
        string author,
        string type,
        string source,
        int malId = 0,
        int? anilistId = null,
        long? mangaUpdateId = null,
        List<string>? synonyms = null,
        List<string>? genres = null,
        List<string>? categories = null,
        string? description = null,
        string? imageUrl = null,
        string? localImageUrl = null,
        long thumbnailSize = 0,
        double? rating = null,
        int popularity = 0,
        int members = 0,
        bool? nsfw = false,
        string? status = null,
        DateTime? releaseDate = null,
        int totalView = 0,
        DateTime? createdAt = null,
        DateTime? updatedAt = null,
        string? url = null,
        List<Chapter>? chapters = null) : base(id)
    {
        Title = Guard.NotNullOrWhiteSpace(title, nameof(title));
        Author = author ?? string.Empty;
        Type = type ?? string.Empty;
        MalId = malId;
        AnilistId = anilistId;
        MangaUpdateId = mangaUpdateId;
        Synonyms = synonyms ?? [];
        Genres = genres ?? [];
        Categories = categories ?? [];
        Description = description;
        ImageUrl = imageUrl;
        LocalImageUrl = localImageUrl;
        ThumbnailSize = thumbnailSize;
        Rating = rating;
        Popularity = popularity;
        Members = members;
        Nsfw = nsfw ?? false;
        Status = status;
        ReleaseDate = releaseDate;
        TotalView = totalView;
        CreatedAt = createdAt ?? DateTime.UtcNow;
        UpdatedAt = updatedAt ?? DateTime.UtcNow;
        Url = url;
        Chapters = chapters ?? [];
    }

    public static Manga Create(
        string title,
        string author,
        string type,
        string source,
        int malId = 0,
        int? anilistId = null,
        long? mangaUpdateId = null,
        List<string>? synonyms = null,
        List<string>? genres = null,
        List<string>? categories = null,
        string? description = null,
        string? imageUrl = null,
        string? url = null,
        double? rating = null,
        string? status = null,
        DateTime? releaseDate = null,
        bool? nsfw=null)
    {
        var id = MangaId.New();
        var manga = new Manga(
            id, title, author, type, source,
            malId: malId, anilistId: anilistId, mangaUpdateId: mangaUpdateId, synonyms: synonyms, genres: genres, categories: categories, description: description, imageUrl: imageUrl, url: url,
            rating: rating, status: status, releaseDate: releaseDate, nsfw:nsfw);

        manga.RaiseDomainEvent(new MangaCreatedDomainEvent(id, title, source));
        return manga;
    }

    public static Manga Reconstitute(
        MangaId id,
        string title,
        string author,
        string type,
        int malId,
        int? anilistId,
        long? mangaUpdateId,
        List<string>? synonyms,
        List<string>? genres,
        List<string>? categories,
        string? description,
        string? imageUrl,
        string? localImageUrl,
        long thumbnailSize,
        double? rating,
        int popularity,
        int members,
        bool? nsfw,
        string? status,
        DateTime? releaseDate,
        int totalView,
        DateTime createdAt,
        DateTime updatedAt,
        string? url,
        List<Chapter>? chapters)
    {
        return new Manga(
            id, title, author, type, "Unknown",
            malId, anilistId, mangaUpdateId, synonyms, genres, categories, description, imageUrl, localImageUrl, thumbnailSize,
            rating, popularity, members, nsfw, status, releaseDate, totalView,
            createdAt, updatedAt, url, chapters);
    }

    public void UpdateMetadata(
        int malId,
        int? anilistId,
        long? mangaUpdateId,
        string author,
        string type,
        List<string>? synonyms,
        List<string> genres,
        List<string>? categories,
        string? description,
        double? rating,
        int popularity,
        int members,
        bool? nsfw,
        string? status,
        DateTime? releaseDate,
        int totalView)
    {
        MalId = malId;
        AnilistId = anilistId;
        MangaUpdateId = mangaUpdateId;
        Author = author;
        Type = type;
        Synonyms = synonyms ?? [];
        Genres = genres ?? [];
        Categories = categories ?? [];
        Description = description ?? Description;
        Rating = rating ?? Rating;
        Popularity = popularity > 0 ? popularity : Popularity;
        Members = members > 0 ? members : Members;
        Nsfw = nsfw ?? false;
        Status = status ?? Status;
        ReleaseDate = releaseDate ?? ReleaseDate;
        TotalView = totalView;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateFromScrapper(
        int malId,
        double? rating,
        int popularity,
        int members,
        DateTime? releaseDate,
        string? status,
        string? author)
    {
        if (malId != 0) MalId = malId;
        if (rating.HasValue) Rating = rating;
        if (popularity > 0) Popularity = popularity;
        if (members > 0) Members = members;
        if (releaseDate.HasValue) ReleaseDate = releaseDate;
        if (!string.IsNullOrWhiteSpace(status)) Status = status;
        if (!string.IsNullOrWhiteSpace(author) && string.IsNullOrWhiteSpace(Author)) Author = author;
        UpdatedAt = DateTime.UtcNow;
    }

    public void ReconstituteFromAnilist(AnilistMedia anilistInfo)
    {
        AnilistId = anilistInfo.Id;
        MalId = anilistInfo.IdMal ?? MalId;
        Description = string.IsNullOrEmpty(Description) ? anilistInfo.Description : Description;
        Rating = Rating ?? (anilistInfo.AverageScore.HasValue ? anilistInfo.AverageScore.Value / 10.0 : null);
        Popularity = anilistInfo.Popularity ?? Popularity;
        Members = anilistInfo.Favorites?? Members;

        Status = anilistInfo.Status switch
        {
            "FINISHED" => "Completed",
            "RELEASING" => "Ongoing",
            "HIATUS" => "On Hiatus",
            "CANCELLED" => "Discontinued",
            "NOT_YET_RELEASED" => "Upcoming",
            _ => Status ?? "Unknown"
        };

        if (anilistInfo.StartDate?.Year != null)
        {
            int year = anilistInfo.StartDate.Year.Value;
            int month = anilistInfo.StartDate.Month ?? 1;
            int day = anilistInfo.StartDate.Day ?? 1;
            ReleaseDate = ReleaseDate ?? new DateTime(year, month, day);
        }

        if (anilistInfo.Genres != null && anilistInfo.Genres.Any())
        {
            Genres = (Genres ?? []).Union(anilistInfo.Genres, StringComparer.OrdinalIgnoreCase).ToList();
        }

        if (anilistInfo.Synonyms != null && anilistInfo.Synonyms.Any())
        {
            Synonyms = (Synonyms ?? []).Union(anilistInfo.Synonyms.Where(s => !string.IsNullOrWhiteSpace(s)), StringComparer.OrdinalIgnoreCase).ToList();
        }

        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateFromAnilist(Manga other)
    {
        if (other.AnilistId.HasValue) AnilistId = other.AnilistId;
        if (other.MalId != 0 && MalId == 0) MalId = other.MalId;
        if (string.IsNullOrWhiteSpace(Description) && !string.IsNullOrWhiteSpace(other.Description)) Description = other.Description;
        if (other.Rating.HasValue && !Rating.HasValue) Rating = other.Rating;
        if (other.Popularity > 0 && Popularity == 0) Popularity = other.Popularity;
        if (!string.IsNullOrWhiteSpace(other.Status)) Status = other.Status;
        if (other.ReleaseDate.HasValue) ReleaseDate = other.ReleaseDate;
        if (!string.IsNullOrWhiteSpace(other.Author) && other.Author != "Unknown" && (string.IsNullOrWhiteSpace(Author) || Author == "Unknown")) Author = other.Author;
        if (other.Genres != null && other.Genres.Any())
        {
            Genres = (Genres ?? []).Union(other.Genres, StringComparer.OrdinalIgnoreCase).ToList();
        }
        if (other.Categories != null && other.Categories.Any())
        {
            Categories = (Categories ?? []).Union(other.Categories, StringComparer.OrdinalIgnoreCase).ToList();
        }
        if (other.Synonyms != null && other.Synonyms.Any())
        {
            Synonyms = (Synonyms ?? []).Union(other.Synonyms.Where(s => !string.IsNullOrWhiteSpace(s)), StringComparer.OrdinalIgnoreCase).ToList();
        }
        UpdatedAt = DateTime.UtcNow;
    }

    public void AddChapter(Chapter chapter)
    {
        Chapters.RemoveAll(c => c.Number == chapter.Number && c.ChapterProvider == chapter.ChapterProvider);
        Chapters.Add(chapter);
        UpdatedAt = DateTime.UtcNow;
        RaiseDomainEvent(new ChapterScrapedDomainEvent(Id, chapter.Id, chapter.Number, chapter.ChapterProvider ?? "Unknown"));
    }

    public void AddChapters(List<Chapter> chapters)
    {
        foreach (var chap in chapters)
        {
            Chapters.RemoveAll(c => c.Number == chap.Number && c.ChapterProvider == chap.ChapterProvider);
            Chapters.Add(chap);
        }
        UpdatedAt = DateTime.UtcNow;
    }

    public void SetUrl(string url)
    {
        Url = url;
    }

    public void SetType(string type)
    {
        Type = type;
    }

    public void SetDates(DateTime createdAt, DateTime updatedAt)
    {
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public void DeleteChapter(ChapterId chapterId)
    {
        Chapters.RemoveAll(c => c.Id == chapterId);
        UpdatedAt = DateTime.UtcNow;
    }

    public void IncrementView()
    {
        TotalView++;
    }

    public bool IncrementChapterView(ChapterId chapterId)
    {
        var chapter = Chapters.FirstOrDefault(c => c.Id == chapterId);
        if (chapter is null) return false;

        chapter.IncrementView();
        TotalView++;
        return true;
    }

    public void UpdateLocalImage(string localImageUrl, long size)
    {
        LocalImageUrl = localImageUrl;
        ThumbnailSize = size;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateImageUrl(string imageUrl)
    {
        ImageUrl = imageUrl;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateThumbnail(string imageUrl, string localImageUrl, long size)
    {
        ImageUrl = imageUrl;
        LocalImageUrl = localImageUrl;
        ThumbnailSize = size;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateTitleAndFileRoutes(string newTitle, string newCleanTitle, string oldCleanTitle)
    {
        var oldTitle = Title;
        Title = Guard.NotNullOrWhiteSpace(newTitle, nameof(newTitle));

        if (!string.IsNullOrWhiteSpace(oldTitle) && !Synonyms.Any(s => string.Equals(s, oldTitle, StringComparison.OrdinalIgnoreCase)))
        {
            Synonyms.Add(oldTitle);
        }

        if (!string.IsNullOrEmpty(LocalImageUrl))
        {
            LocalImageUrl = MigrateRelativePath(LocalImageUrl, oldCleanTitle, newCleanTitle);
        }

        foreach (var chapter in Chapters)
        {
            foreach (var page in chapter.Pages)
            {
                if (!string.IsNullOrEmpty(page.LocalImageUrl))
                {
                    page.UpdateLocalImageUrl(MigrateRelativePath(page.LocalImageUrl, oldCleanTitle, newCleanTitle));
                }
            }
        }

        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateTitleOnly(string newTitle)
    {
        var oldTitle = Title;
        Title = Guard.NotNullOrWhiteSpace(newTitle, nameof(newTitle));

        if (!string.IsNullOrWhiteSpace(oldTitle) && !Synonyms.Any(s => string.Equals(s, oldTitle, StringComparison.OrdinalIgnoreCase)))
        {
            Synonyms.Add(oldTitle);
        }

        UpdatedAt = DateTime.UtcNow;
    }

    private static string MigrateRelativePath(string currentPath, string oldCleanTitle, string newCleanTitle)
    {
        if (string.IsNullOrEmpty(currentPath)) return currentPath;

        var normalized = currentPath.Replace('\\', '/');
        if (normalized.StartsWith(oldCleanTitle + "/", StringComparison.OrdinalIgnoreCase))
        {
            return newCleanTitle + normalized[oldCleanTitle.Length..];
        }
        if (normalized.StartsWith("/" + oldCleanTitle + "/", StringComparison.OrdinalIgnoreCase))
        {
            return "/" + newCleanTitle + normalized[(oldCleanTitle.Length + 1)..];
        }
        return normalized;
    }
}

