using MangaScrapper.Core.DomainEvents;
using MangaScrapper.Core.ValueObjects;
using NovaStack.SharedKernel.Common;

namespace MangaScrapper.Core.Aggregates;

public class UserLibrary : Entity<Guid>
{
    public string UserId { get; private set; }
    public MangaId MangaId { get; private set; }
    public DateTime AddedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }
    public string Status { get; private set; }
    public bool IsFavorite { get; private set; }

    private UserLibrary(Guid id, string userId, MangaId mangaId, DateTime addedAt, DateTime updatedAt, string status, bool isFavorite)
        : base(id)
    {
        UserId = Guard.NotNullOrWhiteSpace(userId, nameof(userId));
        MangaId = mangaId;
        AddedAt = addedAt;
        UpdatedAt = updatedAt;
        Status = status;
        IsFavorite = isFavorite;
    }

    public static UserLibrary Create(string userId, MangaId mangaId, string status)
    {
        var id = Guid.CreateVersion7();
        var userLibrary = new UserLibrary(id, userId, mangaId, DateTime.UtcNow,DateTime.UtcNow,status,false);
        userLibrary.RaiseDomainEvent(new UserLibraryUpdatedDomainEvent(id, userId, mangaId, "Added"));
        return userLibrary;
    }

    public static UserLibrary Reconstitute(Guid id, string userId, MangaId mangaId, DateTime addedAt, DateTime updatedAt, string status, bool isFavorite)
    {
        return new UserLibrary(id, userId, mangaId, addedAt, updatedAt, status, isFavorite);
    }
    public void UpdateLibrary(string status, bool isFavorite)
    {
        Status = status;
        IsFavorite = isFavorite;
        UpdatedAt = DateTime.UtcNow;
    }
}
