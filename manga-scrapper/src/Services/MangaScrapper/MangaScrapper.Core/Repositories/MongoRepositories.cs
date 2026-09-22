using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Persistence;
using MangaScrapper.Core.Persistence.Documents;
using MangaScrapper.Core.ValueObjects;
using MongoDB.Bson;
using MongoDB.Driver;
using NovaStack.SharedKernel.Common;

namespace MangaScrapper.Core.Repositories;

public class MongoUserRepository(MangaMongoDbContext dbContext) : IUserRepository
{
    public async Task<User?> GetByIdAsync(UserId id, CancellationToken ct = default)
    {
        var doc = await dbContext.Users.Find(u => u.Id == id.Value).FirstOrDefaultAsync(ct);
        return doc is null ? null : MapToDomain(doc);
    }

    public async Task<User?> GetByUsernameAsync(string username, CancellationToken ct = default)
    {
        var doc = await dbContext.Users.Find(u => u.Username == username).FirstOrDefaultAsync(ct);
        return doc is null ? null : MapToDomain(doc);
    }

    public async Task<User?> GetByEmailAsync(string email, CancellationToken ct = default)
    {
        var doc = await dbContext.Users.Find(u => u.Email == email).FirstOrDefaultAsync(ct);
        return doc is null ? null : MapToDomain(doc);
    }

    public async Task<PagedList<User>> GetPagedAsync(string? search, string sortBy, string orderBy, int page, int pageSize,
        CancellationToken ct = default)
    {
        var builder = Builders<UserDocument>.Filter;
        var filter = builder.Empty;

        if (!string.IsNullOrWhiteSpace(search))
        {
            filter &= builder.Regex(m => m.Username, new BsonRegularExpression(search, "i"));
        }
        
        var totalCount = await dbContext.Users.CountDocumentsAsync(filter, cancellationToken: ct);
        var sortBuilder = Builders<UserDocument>.Sort;
        SortDefinition<UserDocument> sortDefinition = sortBy.ToLowerInvariant() switch
        {
            "username" => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.Username)
                : sortBuilder.Descending(m => m.Username),
            "createdat" => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.CreatedAt)
                : sortBuilder.Descending(m => m.CreatedAt),
            _ => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.Id)
                : sortBuilder.Descending(m => m.Id),
        };
        var docs = await dbContext.Users.Find(filter)
            .Sort(sortDefinition)
            .Skip((page - 1) * pageSize)
            .Limit(pageSize)
            .ToListAsync(ct);
        var items = docs.Select(MapToDomain).ToList();
        return new PagedList<User>(items, page, pageSize, (int)totalCount);
    }

    public async Task<User?> GetByFirebaseUidOrEmailAsync(string firebaseUid, string email, CancellationToken ct = default)
    {
        var doc = await dbContext.Users.Find(u => u.FirebaseUid == firebaseUid || u.Email == email).FirstOrDefaultAsync(ct);
        return doc is null ? null : MapToDomain(doc);
    }

    public async Task<long> CountByRoleAsync(string role, CancellationToken ct = default)
    {
        return await dbContext.Users.CountDocumentsAsync(u => u.Roles.Contains(role), cancellationToken: ct);
    }

    public async Task<List<string>> GetFcmTokensByUserIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default)
    {
        var idList = userIds.ToList();
        if (idList.Count == 0) return new List<string>();

        var docs = await dbContext.Users
            .Find(u => idList.Contains(u.Id) && u.IsActive && u.FcmTokens.Count > 0)
            .Project(u => u.FcmTokens)
            .ToListAsync(ct);

        return docs.SelectMany(t => t).Where(t => !string.IsNullOrWhiteSpace(t)).Distinct().ToList();
    }

    public async Task AddFcmTokenAsync(UserId userId, string fcmToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(fcmToken)) return;
        var update = Builders<UserDocument>.Update.AddToSet(u => u.FcmTokens, fcmToken);
        await dbContext.Users.UpdateOneAsync(u => u.Id == userId.Value, update, cancellationToken: ct);
    }

    public async Task RemoveFcmTokenAsync(UserId userId, string fcmToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(fcmToken)) return;
        var update = Builders<UserDocument>.Update.Pull(u => u.FcmTokens, fcmToken);
        await dbContext.Users.UpdateOneAsync(u => u.Id == userId.Value, update, cancellationToken: ct);
    }

    public async Task AddAsync(User user, CancellationToken ct = default)
    {
        var doc = MapToDocument(user);
        await dbContext.Users.InsertOneAsync(doc, cancellationToken: ct);
    }

    public async Task UpdateAsync(User user, CancellationToken ct = default)
    {
        var doc = MapToDocument(user);
        await dbContext.Users.ReplaceOneAsync(u => u.Id == doc.Id, doc, cancellationToken: ct);
    }
    
    private static User MapToDomain(UserDocument doc)
    {
        return User.Reconstitute(
            UserId.From(doc.Id),
            doc.Username,
            doc.PasswordHash,
            doc.Email,
            doc.Roles ?? new List<string>(),
            doc.IsActive,
            doc.FirebaseUid,
            doc.FcmTokens ?? new List<string>(),
            doc.CreatedAt,
            doc.LastActiveAt,
            doc.ClientIpAddress);
    }

    private static UserDocument MapToDocument(User user)
    {
        return new UserDocument
        {
            Id = user.Id.Value,
            Username = user.Username,
            PasswordHash = user.PasswordHash,
            Email = user.Email,
            Roles = user.Roles ?? new List<string>(),
            IsActive = user.IsActive,
            FirebaseUid = user.FirebaseUid,
            FcmTokens = user.FcmTokens ?? new List<string>(),
            CreatedAt = user.CreatedAt,
            LastActiveAt = user.LastActiveAt,
            ClientIpAddress = user.ClientIpAddress
        };
    }
}

public class MongoUserLibraryRepository(MangaMongoDbContext dbContext) : IUserLibraryRepository
{
    public async Task<UserLibrary?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var doc = await dbContext.UserLibraries.Find(l => l.Id == id).FirstOrDefaultAsync(ct);
        return doc is null ? null : MapToDomain(doc);
    }

    public async Task<UserLibrary?> GetByUserIdAndMangaIdAsync(string userId, MangaId mangaId, CancellationToken ct = default)
    {
        if (!Guid.TryParse(userId, out var userGuid)) return null;
        var doc = await dbContext.UserLibraries.Find(l => l.UserId == userGuid && l.MangaId == mangaId.Value).FirstOrDefaultAsync(ct);
        return doc is null ? null : MapToDomain(doc);
    }

    public async Task<List<UserLibrary>> GetAllAsync(string userId, CancellationToken ct = default)
    {
        if (!Guid.TryParse(userId, out var userGuid)) return new List<UserLibrary>();
        var doc = await dbContext.UserLibraries.Find(l => l.UserId == userGuid).ToListAsync(ct);
        return doc is null ? new() : doc.Select(MapToDomain).ToList();
    }

    public async Task<List<Guid>> GetUserIdsByMangaIdAsync(Guid mangaId, CancellationToken ct = default)
    {
        var docs = await dbContext.UserLibraries
            .Find(l => l.MangaId == mangaId)
            .Project(l => l.UserId)
            .ToListAsync(ct);
        return docs.Distinct().ToList();
    }

    public async Task<PagedList<UserLibrary>> GetPagedByUserIdAsync(string userId,string? search,string? type,string? status,bool? isFavorite,string sortBy, string orderBy, int page, int pageSize, CancellationToken ct = default)
    {
        if (!Guid.TryParse(userId, out var userGuid))
            return new PagedList<UserLibrary>([], page, pageSize, 0);

        var builder = Builders<UserLibraryDocument>.Filter;
        var filter = builder.Empty;

        if (!string.IsNullOrWhiteSpace(search))
        {
            // Build a regex filter for MangaTitle (case-insensitive)
            var titleFilter = builder.Regex(m => m.MangaTitle, new BsonRegularExpression(search, "i"));

            // Check if the search term can be parsed into a valid Guid
            if (Guid.TryParse(search, out Guid parsedGuid))
            {
                var idFilter = builder.Eq(m => m.MangaId, parsedGuid);
        
                // Match either the Title regex OR the exact Guid
                filter &= (titleFilter | idFilter);
            }
            else
            {
                // If it's not a valid Guid, filter by Title only
                filter &= titleFilter;
            }
        }
        
        if (userGuid!=Guid.Empty)
        {
            filter &= builder.Eq(m => m.UserId, userGuid);
        }
        
        if (!string.IsNullOrWhiteSpace(status))
        {
            filter &= builder.Eq(m => m.Status, status);
        }

        if (!string.IsNullOrWhiteSpace(type))
        {
            filter &= builder.Eq(m => m.Type, type);
        }
        
        if (isFavorite is not null)
        {
            filter &= builder.Eq(m => m.IsFavorite, isFavorite);
        }
        
        var sortBuilder = Builders<UserLibraryDocument>.Sort;
        SortDefinition<UserLibraryDocument> sortDefinition = sortBy.ToLowerInvariant() switch
        {
            "mangatitle" => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.MangaTitle)
                : sortBuilder.Descending(m => m.MangaTitle),
            "addedat" => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.AddedAt)
                : sortBuilder.Descending(m => m.AddedAt),
            "updatedat" => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.UpdatedAt)
                : sortBuilder.Descending(m => m.UpdatedAt),
            _ => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.Id)
                : sortBuilder.Descending(m => m.Id),
        };
        
        var totalCount = await dbContext.UserLibraries.CountDocumentsAsync(filter, cancellationToken: ct);
        var docs = await dbContext.UserLibraries.Find(filter)
            .Sort(sortDefinition)
            .Skip((page - 1) * pageSize)
            .Limit(pageSize)
            .ToListAsync(ct);

        var items = docs.Select(MapToDomain).ToList();
        return new PagedList<UserLibrary>(items, page, pageSize, (int)totalCount);
    }

    public async Task AddAsync(UserLibrary userLibrary, CancellationToken ct = default)
    {
        var doc = MapToDocument(userLibrary);
        await dbContext.UserLibraries.InsertOneAsync(doc, cancellationToken: ct);
    }

    public async Task UpdateAsync(UserLibrary userLibrary, CancellationToken ct = default)
    {
        var doc = MapToDocument(userLibrary);
        await dbContext.UserLibraries.ReplaceOneAsync(u => u.Id == doc.Id, doc, cancellationToken: ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await dbContext.UserLibraries.DeleteOneAsync(l => l.Id == id, ct);
    }

    public async Task DeleteByMangaIdAsync(Guid mangaId, CancellationToken ct = default)
    {
        await dbContext.UserLibraries.DeleteManyAsync(l => l.MangaId == mangaId, ct);
    }

    public async Task UpdateMangaInfoAsync(Guid mangaId, string newTitle, string? newImageUrl, CancellationToken ct = default)
    {
        var filter = Builders<UserLibraryDocument>.Filter.Eq(l => l.MangaId, mangaId);
        var update = Builders<UserLibraryDocument>.Update
            .Set(l => l.MangaTitle, newTitle)
            .Set(l => l.UpdatedAt, DateTime.UtcNow);

        if (!string.IsNullOrEmpty(newImageUrl))
        {
            update = update.Set(l => l.MangaImageUrl, newImageUrl);
        }

        await dbContext.UserLibraries.UpdateManyAsync(filter, update, cancellationToken: ct);
    }

    private static UserLibrary MapToDomain(UserLibraryDocument doc)
    {
        return UserLibrary.Reconstitute(doc.Id, doc.UserId.ToString(), MangaId.From(doc.MangaId), doc.AddedAt,doc.UpdatedAt,doc.Status,doc.IsFavorite);
    }

    private static UserLibraryDocument MapToDocument(UserLibrary library)
    {
        Guid.TryParse(library.UserId, out var userGuid);
        return new UserLibraryDocument
        {
            Id = library.Id,
            UserId = userGuid,
            MangaId = library.MangaId.Value,
            AddedAt = library.AddedAt,
            UpdatedAt = DateTime.UtcNow,
            Status = library.Status,
            IsFavorite = library.IsFavorite,
        };
    }
}

public class MongoUserProgressionRepository(MangaMongoDbContext dbContext) : IUserProgressionRepository
{
    public async Task<UserProgression?> GetByUserIdAndMangaIdAsync(string userId, MangaId mangaId, CancellationToken ct = default)
    {
        if (!Guid.TryParse(userId, out var userGuid)) return null;
        var doc = await dbContext.UserProgressions.Find(p => p.UserId == userGuid && p.MangaId == mangaId.Value).FirstOrDefaultAsync(ct);
        return doc is null ? null : MapToDomain(doc);
    }

    public async Task<List<UserProgression>> GetByUserIdAsync(string userId, CancellationToken ct = default)
    {
        if (!Guid.TryParse(userId, out var userGuid)) return [];
        var docs = await dbContext.UserProgressions.Find(p => p.UserId == userGuid).SortByDescending(s=>s.LastReadAt).ToListAsync(ct);
        return docs.Select(MapToDomain).ToList();
    }

    public async Task AddOrUpdateAsync(UserProgression userProgression, CancellationToken ct = default)
    {
        var doc = MapToDocument(userProgression);
        await dbContext.UserProgressions.ReplaceOneAsync(
            p => p.UserId == doc.UserId && p.MangaId == doc.MangaId,
            doc,
            new ReplaceOptions { IsUpsert = true },
            cancellationToken: ct);
    }

    public async Task DeleteByMangaIdAsync(Guid mangaId, CancellationToken ct = default)
    {
        await dbContext.UserProgressions.DeleteManyAsync(p => p.MangaId == mangaId, ct);
    }

    public async Task RemoveChapterLogAsync(Guid mangaId, Guid chapterId, CancellationToken ct = default)
    {
        var filter = Builders<UserProgressionDocument>.Filter.Eq(p => p.MangaId, mangaId);
        var update = Builders<UserProgressionDocument>.Update.PullFilter(
            p => p.ChapterLogs,
            log => log.ChapterId == chapterId);

        await dbContext.UserProgressions.UpdateManyAsync(filter, update, cancellationToken: ct);
    }

    private static UserProgression MapToDomain(UserProgressionDocument doc)
    {
        return UserProgression.Reconstitute(
            doc.Id,
            doc.UserId.ToString(),
            MangaId.From(doc.MangaId),
            doc.LastReadAt,
            doc.TotalReadingTime,
            doc.ChapterLogs.Select(cl => UserProgression.ChapterLog.Reconstitute(
                cl.Id,
                cl.ChapterId,
                cl.ChapterNumber,
                cl.LastReadPage,
                cl.TotalPages,
                cl.IsCompleted,
                cl.ReadingTimeSeconds,
                cl.LastReadAt)).ToList()
        );
    }

    private static UserProgressionDocument MapToDocument(UserProgression progression)
    {
        Guid.TryParse(progression.UserId, out var userGuid);
        return new UserProgressionDocument
        {
            Id = progression.Id,
            UserId = userGuid,
            MangaId = progression.MangaId.Value,
            LastReadAt = progression.LastReadAt,
            TotalReadingTime = progression.ChapterLogs.Sum(x=>x.ReadingTimeSeconds),
            ChapterLogs = progression.ChapterLogs.Select(cl => new ChapterLogDocument
            {
                Id = cl.Id,
                ChapterId = cl.ChapterId,
                ChapterNumber = cl.ChapterNumber,
                LastReadPage = cl.LastReadPage,
                TotalPages = cl.TotalPages,
                IsCompleted = cl.IsCompleted,
                ReadingTimeSeconds = cl.ReadingTimeSeconds,
                LastReadAt = cl.LastReadAt
            }).ToList()
        };
    }
}
