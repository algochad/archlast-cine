using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.ValueObjects;
using NovaStack.Contracts.Requests;
using NovaStack.SharedKernel.Common;

namespace MangaScrapper.Core.Repositories;

public interface IMangaRepository
{
    Task<Manga?> GetByIdAsync(MangaId id, CancellationToken ct = default,bool excludePage = false);
    Task<Manga?> GetByTitleAsync(string title, CancellationToken ct = default);
    Task<PagedList<Manga>> GetPagedAsync(
        string? search, 
        List<string>? genres, 
        string? status, 
        string? type,
        string sortBy,
        string orderBy,
        int page, 
        int pageSize, 
        CancellationToken ct = default,
        bool excludePage = true);
    Task<List<Manga>> GetByIdsAsync(List<Guid> ids, CancellationToken ct);
    Task AddAsync(Manga manga, CancellationToken ct = default);
    Task UpdateAsync(Manga manga, CancellationToken ct = default);
    Task DeleteAsync(MangaId id, CancellationToken ct = default);
    Task<List<string>> GetAllGenresAsync(CancellationToken ct);
    Task<List<string>> GetAllTypesAsync(CancellationToken ct);
    Task<DashboardStatistic> GetStatisticsAsync(CancellationToken ct);
    Task<(List<Manga> Items, int TotalCount)> GetTrendingAsync(
        string? search, 
        List<string>? genres, 
        string? status, 
        string? type,
        int page, 
        int pageSize, 
        CancellationToken ct);

    Task<List<Manga>> GetAllAsync(CancellationToken ct = default);
    Task<List<Manga>> GetWithAnilistAsync(CancellationToken ct = default);
    Task UpdateChapterPagesAsync(Guid mangaId, Guid chapterId, List<Page> pages, CancellationToken ct = default);
    Task<bool> IncrementChapterViewAsync(Guid chapterId, Guid? mangaId = null, CancellationToken ct = default);
}

public interface IMangaExternalRepository
{
    Task<PagedList<Manga>> SearchAsync(
        string? search,
        List<string>? genres,
        string? status,
        string? type,
        string sortBy,
        string orderBy,
        int page,
        int pageSize,
        bool? nsfw = null,
        CancellationToken ct = default);

    Task<PagedList<Manga>> QueryAdvancedAsync(
        MangaAdvancedFilter? filter,
        List<MangaSortOption>? sorts,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task<List<Manga>> GetRecomendationAsync(List<Guid>readingHistoryIds,int limit,  CancellationToken ct = default);
    Task<List<Manga>> GetSimilarAsync(Guid mangaId, int limit, CancellationToken ct = default);
    Task<List<Manga>> SemanticSearchAsync(string query, int limit, CancellationToken ct = default);
    Task<List<Manga>> GetSimilarFilteredAsync(Guid mangaId, string? status, string? type, List<string>? genres, int limit, CancellationToken ct = default);
    Task<List<Manga>> GetSimilarByCategoryAsync(
        List<string> categories,
        string? status = null,
        string? type = null,
        List<string>? genres = null,
        Guid? excludeMangaId = null,
        int limit = 10,
        CancellationToken ct = default);
    Task<List<Manga>> GetAdvancedRecommendationAsync(List<Guid> likedIds, List<Guid> dislikedIds, int limit, CancellationToken ct = default);
    Task IndexMangaAsync(Manga manga, CancellationToken ct = default);
    Task UpsertMangaAsync(Manga manga,CancellationToken ct = default);
}

public interface IUserRepository
{
    Task<User?> GetByIdAsync(UserId id, CancellationToken ct = default);
    Task<User?> GetByUsernameAsync(string username, CancellationToken ct = default);
    Task<User?> GetByEmailAsync(string email, CancellationToken ct = default);
    Task<PagedList<User>> GetPagedAsync(
        string? search, 
        string sortBy,
        string orderBy,
        int page, 
        int pageSize, 
        CancellationToken ct = default);
    Task<User?> GetByFirebaseUidOrEmailAsync(string firebaseUid, string email, CancellationToken ct = default);
    Task<long> CountByRoleAsync(string role, CancellationToken ct = default);
    Task<List<string>> GetFcmTokensByUserIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default);
    Task AddFcmTokenAsync(UserId userId, string fcmToken, CancellationToken ct = default);
    Task RemoveFcmTokenAsync(UserId userId, string fcmToken, CancellationToken ct = default);
    Task AddAsync(User user, CancellationToken ct = default);
    Task UpdateAsync(User user, CancellationToken ct = default);
}

public interface IUserLibraryRepository
{
    Task<UserLibrary?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<UserLibrary?> GetByUserIdAndMangaIdAsync(string userId, MangaId mangaId, CancellationToken ct = default);
    Task<List<UserLibrary>> GetAllAsync(string userId, CancellationToken ct = default);
    Task<List<Guid>> GetUserIdsByMangaIdAsync(Guid mangaId, CancellationToken ct = default);
    Task<PagedList<UserLibrary>> GetPagedByUserIdAsync(string userId,string? search,string? type,string? status,bool? isFavorite,string sortBy, string orderBy, int page, int pageSize, CancellationToken ct = default);
    Task AddAsync(UserLibrary userLibrary, CancellationToken ct = default);
    Task UpdateAsync(UserLibrary userLibrary, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task DeleteByMangaIdAsync(Guid mangaId, CancellationToken ct = default);
    Task UpdateMangaInfoAsync(Guid mangaId, string newTitle, string? newImageUrl, CancellationToken ct = default);
}

public interface IUserProgressionRepository
{
    Task<UserProgression?> GetByUserIdAndMangaIdAsync(string userId, MangaId mangaId, CancellationToken ct = default);
    Task<List<UserProgression>> GetByUserIdAsync(string userId, CancellationToken ct = default);
    Task AddOrUpdateAsync(UserProgression userProgression, CancellationToken ct = default);
    Task DeleteByMangaIdAsync(Guid mangaId, CancellationToken ct = default);
    Task RemoveChapterLogAsync(Guid mangaId, Guid chapterId, CancellationToken ct = default);
}
