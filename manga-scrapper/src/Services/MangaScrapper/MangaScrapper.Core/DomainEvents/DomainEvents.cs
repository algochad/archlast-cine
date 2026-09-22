using MangaScrapper.Core.ValueObjects;
using NovaStack.SharedKernel.Abstractions;

namespace MangaScrapper.Core.DomainEvents;

public record MangaCreatedDomainEvent(
    MangaId MangaId,
    string Title,
    string Source,
    Guid EventId,
    DateTime OccurredOn) : IDomainEvent
{
    public MangaCreatedDomainEvent(MangaId mangaId, string title, string source)
        : this(mangaId, title, source, Guid.CreateVersion7(), DateTime.UtcNow) { }
}

public record ChapterScrapedDomainEvent(
    MangaId MangaId,
    ChapterId ChapterId,
    double ChapterNumber,
    string ChapterProvider,
    Guid EventId,
    DateTime OccurredOn) : IDomainEvent
{
    public ChapterScrapedDomainEvent(MangaId mangaId, ChapterId chapterId, double chapterNumber, string chapterProvider)
        : this(mangaId, chapterId, chapterNumber, chapterProvider, Guid.CreateVersion7(), DateTime.UtcNow) { }
}

public record UserLibraryUpdatedDomainEvent(
    Guid UserLibraryId,
    string UserId,
    MangaId MangaId,
    string Action,
    Guid EventId,
    DateTime OccurredOn) : IDomainEvent
{
    public UserLibraryUpdatedDomainEvent(Guid userLibraryId, string userId, MangaId mangaId, string action)
        : this(userLibraryId, userId, mangaId, action, Guid.CreateVersion7(), DateTime.UtcNow) { }
}
