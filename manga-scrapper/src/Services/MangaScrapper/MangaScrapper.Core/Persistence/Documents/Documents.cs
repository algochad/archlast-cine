using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace MangaScrapper.Core.Persistence.Documents;

public class MangaDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; }
    
    public int MalId { get; set; }
    [BsonIgnoreIfNull]
    public int? AnilistId { get; set; }
    [BsonIgnoreIfNull]
    public long? MangaUpdateId { get; set; }
    public string Title { get; set; } = string.Empty;
    [BsonIgnoreIfNull]
    public List<string>? Synonyms { get; set; }
    public string Author { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public double? Rating { get; set; }
    public int Popularity { get; set; }
    public int Members { get; set; }

    [BsonIgnoreIfNull]
    public List<string>? Genres { get; set; }
    [BsonIgnoreIfNull]
    public List<string>? Categories { get; set; }

    [BsonIgnoreIfNull]
    public string? Description { get; set; }

    [BsonIgnoreIfNull]
    public string? ImageUrl { get; set; }
    public string? LocalImageUrl { get; set; }
    public long ThumbnailSize { get; set; }
    [BsonIgnoreIfNull]
    public bool? Nsfw { get; set; }
    [BsonIgnoreIfNull]
    public string? Status { get; set; }
    public DateTime? ReleaseDate { get; set; }
    public int TotalView { get; set; }

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime CreatedAt { get; set; }

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime UpdatedAt { get; set; }

    [BsonIgnoreIfNull]
    public string? Url { get; set; }

    public List<ChapterDocument> Chapters { get; set; } = new();
}

public class ChapterDocument
{
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public double Number { get; set; }

    [BsonIgnoreIfNull]
    public string? Link { get; set; }
    public string? ChapterProvider { get; set; }
    public string? ChapterProviderIcon { get; set; }
    public string Language { get; set; } = string.Empty;
    public int TotalView { get; set; }

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime UploadDate { get; set; }

    [BsonElement("pages")]
    [BsonIgnoreIfNull]
    public List<PageDocument> Pages { get; set; } = new();
}

public class PageDocument
{
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string ImageUrl { get; set; } = default!;

    [BsonIgnoreIfNull]
    public string? LocalImageUrl { get; set; }
    public long Size { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool IsFallback { get; set; }
}

public class UserDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public List<string> Roles { get; set; } = new();
    public bool IsActive { get; set; } = true;
    public string? FirebaseUid { get; set; }
    public List<string> FcmTokens { get; set; } = new();

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    [BsonIgnoreIfNull]
    public DateTime? LastActiveAt { get; set; }
    [BsonIgnoreIfNull]
    public string? ClientIpAddress { get; set; }
}

public class UserLibraryDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.CreateVersion7();

    [BsonRepresentation(BsonType.String)]
    public Guid UserId { get; set; }

    [BsonRepresentation(BsonType.String)]
    public Guid MangaId { get; set; }
    public string MangaTitle { get; set; } = string.Empty;
    public string Type { get; set; } = "Manga";
    public string? MangaImageUrl { get; set; }
    public string Status { get; set; } = "Reading";
    public bool IsFavorite { get; set; }
    public double LastReadChapter { get; set; }

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class UserProgressionDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.CreateVersion7();

    [BsonRepresentation(BsonType.String)]
    public Guid UserId { get; set; }

    [BsonRepresentation(BsonType.String)]
    public Guid MangaId { get; set; }
    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime LastReadAt { get; set; } = DateTime.UtcNow;
    public List<ChapterLogDocument> ChapterLogs { get; set; } = new();
    public int TotalReadingTime { get; set; }
}

public class ChapterLogDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.CreateVersion7();
    [BsonRepresentation(BsonType.String)]
    public Guid ChapterId { get; set; }
    public double ChapterNumber { get; set; }
    public int LastReadPage { get; set; }
    public int TotalPages { get; set; }
    public bool IsCompleted { get; set; }
    public int ReadingTimeSeconds { get; set; }
    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime LastReadAt { get; set; } = DateTime.UtcNow;
}
