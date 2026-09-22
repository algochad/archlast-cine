using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Persistence;
using MangaScrapper.Core.Persistence.Documents;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using MongoDB.Bson;
using MongoDB.Driver;
using NovaStack.SharedKernel.Common;

namespace MangaScrapper.Core.Repositories;

public class MongoMangaRepository(MangaMongoDbContext dbContext) : IMangaRepository
{
    public async Task<Manga?> GetByIdAsync(MangaId id, CancellationToken ct = default, bool excludePage = false)
    {
        var query = dbContext.Mangas.Find(m => m.Id == id.Value);
        var doc = await (excludePage
            ? query.Project<MangaDocument>(Builders<MangaDocument>.Projection.Exclude("chapters.pages"))
            : query).FirstOrDefaultAsync(ct);

        return doc is null ? null : MapToDomain(doc);
    }

    public async Task<Manga?> GetByTitleAsync(string title, CancellationToken ct = default)
    {
        var doc = await dbContext.Mangas.Find(m => m.Title == title).FirstOrDefaultAsync(ct);
        return doc is null ? null : MapToDomain(doc);
    }

    public async Task<PagedList<Manga>> GetPagedAsync(string? search, List<string>? genres, string? status, string? type, string sortBy, string orderBy, int page,
        int pageSize, CancellationToken ct = default, bool excludePage = true)
    {
        var builder = Builders<MangaDocument>.Filter;
        var filter = builder.Empty;

        if (!string.IsNullOrWhiteSpace(search))
        {
            filter &= builder.Regex(m => m.Title, new BsonRegularExpression(search, "i"));
        }

        if (genres != null && genres.Any())
        {
            filter &= builder.All(m => m.Genres, genres);
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            filter &= builder.Eq(m => m.Status, status);
        }

        if (!string.IsNullOrWhiteSpace(type))
        {
            filter &= builder.Eq(m => m.Type, type);
        }

        var totalCount = await dbContext.Mangas.CountDocumentsAsync(filter, cancellationToken: ct);

        var sortBuilder = Builders<MangaDocument>.Sort;
        SortDefinition<MangaDocument> sortDefinition = sortBy.ToLowerInvariant() switch
        {
            "title" => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.Title)
                : sortBuilder.Descending(m => m.Title),
            "createdat" => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.CreatedAt)
                : sortBuilder.Descending(m => m.CreatedAt),
            "latestchapter" => orderBy == "asc"
                ? sortBuilder.Ascending("Chapters.UploadDate")
                : sortBuilder.Descending("Chapters.UploadDate"),
            "totalview" => orderBy == "asc"
                ? sortBuilder.Ascending("Chapters.TotalView")
                : sortBuilder.Descending("Chapters.TotalView"),
            _ => orderBy == "asc"
                ? sortBuilder.Ascending(m => m.UpdatedAt)
                : sortBuilder.Descending(m => m.UpdatedAt),
        };
        var query = dbContext.Mangas.Find(filter)
            .Sort(sortDefinition)
            .Skip((page - 1) * pageSize)
            .Limit(pageSize);

        var docs = await (excludePage
            ? query.Project<MangaDocument>(Builders<MangaDocument>.Projection.Exclude("chapters.pages"))
            : query).ToListAsync(ct);
        var items = docs.Select(MapToDomain).ToList();
        return new PagedList<Manga>(items, page, pageSize, (int)totalCount);
    }

    public async Task<List<Manga>> GetByIdsAsync(List<Guid> ids, CancellationToken ct)
    {
        var filter = Builders<MangaDocument>.Filter.In(m => m.Id, ids);
        var doc = await dbContext.Mangas.Find(filter)
            .Project<MangaDocument>(Builders<MangaDocument>.Projection.Exclude("chapters.pages"))
            .ToListAsync(ct);
        return doc is null ? new List<Manga>() : doc.Select(MapToDomain).ToList();
    }

    public async Task AddAsync(Manga manga, CancellationToken ct = default)
    {
        var doc = MapToDocument(manga);
        await dbContext.Mangas.InsertOneAsync(doc, cancellationToken: ct);
    }

    public async Task UpdateAsync(Manga manga, CancellationToken ct = default)
    {
        var doc = MapToDocument(manga);
        await dbContext.Mangas.ReplaceOneAsync(m => m.Id == doc.Id, doc, cancellationToken: ct);
    }

    public async Task DeleteAsync(MangaId id, CancellationToken ct = default)
    {
        await dbContext.Mangas.DeleteOneAsync(m => m.Id == id.Value, ct);
    }

    public async Task<List<Manga>> GetAllAsync(CancellationToken ct = default)
    {
        var docs = await dbContext.Mangas.Find(_ => true).ToListAsync(ct);
        return docs.Select(MapToDomain).ToList();
    }

    public async Task<List<Manga>> GetWithAnilistAsync(CancellationToken ct = default)
    {
        var filter = Builders<MangaDocument>.Filter.And(
            Builders<MangaDocument>.Filter.Ne(m => m.AnilistId, null),
            Builders<MangaDocument>.Filter.Gt(m => m.AnilistId, 0)
        );
        var docs = await dbContext.Mangas.Find(filter).ToListAsync(ct);
        return docs.Select(MapToDomain).ToList();
    }

    public async Task UpdateChapterPagesAsync(Guid mangaId, Guid chapterId, List<Page> pages, CancellationToken ct = default)
    {
        var manga = await GetByIdAsync(MangaId.From(mangaId), ct);
        if (manga is null) return;

        var chapter = manga.Chapters.FirstOrDefault(c => c.Id.Value == chapterId);
        if (chapter is null) return;

        chapter.AddPages(pages);
        await UpdateAsync(manga, ct);
    }

    public async Task<bool> IncrementChapterViewAsync(Guid chapterId, Guid? mangaId = null, CancellationToken ct = default)
    {
        var filterBuilder = Builders<MangaDocument>.Filter;
        var filter = mangaId.HasValue
            ? filterBuilder.And(
                filterBuilder.Eq(m => m.Id, mangaId.Value),
                filterBuilder.ElemMatch(m => m.Chapters, c => c.Id == chapterId))
            : filterBuilder.ElemMatch(m => m.Chapters, c => c.Id == chapterId);

        var update = Builders<MangaDocument>.Update
            .Inc(m => m.TotalView, 1)
            .Inc("chapters.$.totalView", 1);

        var result = await dbContext.Mangas.UpdateOneAsync(filter, update, cancellationToken: ct);
        return result.ModifiedCount > 0;
    }

    public async Task<List<string>> GetAllGenresAsync(CancellationToken ct)
    {
        var result = await dbContext.Mangas.Distinct<string>("Genres", Builders<MangaDocument>.Filter.Empty).ToListAsync(ct);
        return result.OrderBy(g => g).ToList();
    }

    public async Task<List<string>> GetAllTypesAsync(CancellationToken ct)
    {
        var result = await dbContext.Mangas.Distinct<string>("Type", Builders<MangaDocument>.Filter.Empty).ToListAsync(ct);
        return result.OrderBy(t => t).ToList();
    }

    public async Task<DashboardStatistic> GetStatisticsAsync(CancellationToken ct)
    {
        var today = DateTime.UtcNow.Date;
        var lastMonth = DateTime.UtcNow.Date.AddDays(-30);

        // Define all aggregation and count tasks for concurrent execution
        var totalMangaTask = dbContext.Mangas.CountDocumentsAsync(_ => true, cancellationToken: ct);

        var totalChaptersTask = dbContext.Mangas.Aggregate()
            .Project(m => new { count = m.Chapters.Count })
            .Group(new BsonDocument { { "_id", BsonNull.Value }, { "total", new BsonDocument("$sum", "$count") } })
            .FirstOrDefaultAsync(ct);

        var providersTask = dbContext.Mangas.Distinct<string>("Chapters.ChapterProvider", FilterDefinition<MangaDocument>.Empty).ToListAsync(ct);

        var scrappedTodayTask = dbContext.Mangas.Aggregate()
            .Unwind<MangaDocument, ChapterDocumentUnwound>(m => m.Chapters)
            .Match(c => c.Chapters.UploadDate >= today)
            .Count()
            .FirstOrDefaultAsync(ct);

        var scrappedThisMonthTask = dbContext.Mangas.Aggregate()
            .Unwind<MangaDocument, ChapterDocumentUnwound>(m => m.Chapters)
            .Match(c => c.Chapters.UploadDate >= lastMonth)
            .Count()
            .FirstOrDefaultAsync(ct);

        var totalUnlinkedMetadataTask = dbContext.Mangas.CountDocumentsAsync(m => m.AnilistId == 0 || m.AnilistId==null, cancellationToken: ct);

        var totalUnavailableMangaChapterTask = dbContext.Mangas
            .Find(m => m.Chapters.Any(c => c.Pages == null || c.Pages.Count == 0))
            .CountDocumentsAsync(ct);

        var thumbnailTask = dbContext.Mangas.Aggregate()
            .Group(new BsonDocument { { "_id", BsonNull.Value }, { "total", new BsonDocument("$sum", "$thumbnailSize") } })
            .FirstOrDefaultAsync(ct);

        var pagesTask = dbContext.Mangas.Aggregate()
            .Project(m => new
            {
                totalSize = m.Chapters.Sum(c => c.Pages.Sum(p => p.Size))
            })
            .Group(new BsonDocument
            {
                { "_id", BsonNull.Value },
                { "total", new BsonDocument("$sum", "$totalSize") }
            })
            .FirstOrDefaultAsync(ct);

        var monthlyScrapTask = dbContext.Mangas.Aggregate()
            .Unwind<MangaDocument, ChapterDocumentUnwound>(m => m.Chapters)
            .Match(c => c.Chapters.UploadDate >= lastMonth)
            .Group(c => new { Date = c.Chapters.UploadDate.Date }, g => new { Date = g.Key.Date, Count = g.Count() })
            .SortBy(x => x.Date)
            .ToListAsync(ct);

        var totalUsersTask = dbContext.Users.CountDocumentsAsync(_ => true, cancellationToken: ct);
        var activeUsersTodayTask = dbContext.Users.CountDocumentsAsync(u => u.LastActiveAt >= today, cancellationToken: ct);
        var activeUsersThisMonthTask = dbContext.Users.CountDocumentsAsync(u => u.LastActiveAt >= lastMonth, cancellationToken: ct);

        var typeBreakdownTask = dbContext.Mangas.Aggregate()
            .Group(m => m.Type, g => new { Type = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var statusBreakdownTask = dbContext.Mangas.Aggregate()
            .Group(m => m.Status, g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var providerBreakdownTask = dbContext.Mangas.Aggregate()
            .Unwind<MangaDocument, ChapterDocumentUnwound>(m => m.Chapters)
            .Group(c => c.Chapters.ChapterProvider, g => new { Provider = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        await Task.WhenAll(
            totalMangaTask,
            totalChaptersTask,
            providersTask,
            scrappedTodayTask,
            scrappedThisMonthTask,
            totalUnlinkedMetadataTask,
            totalUnavailableMangaChapterTask,
            thumbnailTask,
            pagesTask,
            monthlyScrapTask,
            totalUsersTask,
            activeUsersTodayTask,
            activeUsersThisMonthTask,
            typeBreakdownTask,
            statusBreakdownTask,
            providerBreakdownTask
        );

        var totalManga = await totalMangaTask;
        var chaptersResult = await totalChaptersTask;
        var totalChapters = chaptersResult != null && chaptersResult.Contains("total") ? chaptersResult["total"].ToInt64() : 0;

        var providers = await providersTask;
        var totalSourceProvider = providers.Count;

        var scrappedTodayResult = await scrappedTodayTask;
        var scrappedToday = scrappedTodayResult?.Count ?? 0;

        var scrappedThisMonthResult = await scrappedThisMonthTask;
        var scrappedThisMonth = scrappedThisMonthResult?.Count ?? 0;

        var totalUnlinkedMetadata = await totalUnlinkedMetadataTask;
        var totalUnavailableMangaChapter = await totalUnavailableMangaChapterTask;

        var thumbnailResult = await thumbnailTask;
        var totalThumbnailSize = thumbnailResult != null && thumbnailResult.Contains("total") ? thumbnailResult["total"].ToInt64() : 0;

        var pagesResult = await pagesTask;
        var totalPagesSize = pagesResult != null && pagesResult.Contains("total") ? pagesResult["total"].ToInt64() : 0;
        var totalStorageUsed = totalThumbnailSize + totalPagesSize;

        var monthlyScrapRaw = await monthlyScrapTask;
        var monthlyScrap = new List<ScrapStats>();
        for (int i = 0; i <= 30; i++)
        {
            var date = lastMonth.AddDays(i);
            var stats = monthlyScrapRaw.FirstOrDefault(x => x.Date.Date == date.Date);
            monthlyScrap.Add(new ScrapStats
            {
                Date = date,
                TotalScrap = stats?.Count ?? 0
            });
        }

        var totalUsers = await totalUsersTask;
        var activeUsersToday = await activeUsersTodayTask;
        var activeUsersThisMonth = await activeUsersThisMonthTask;

        var rawTypeBreakdown = await typeBreakdownTask;
        var mangaTypeBreakdown = rawTypeBreakdown
            .Where(x => !string.IsNullOrWhiteSpace(x.Type))
            .ToDictionary(x => x.Type!, x => (long)x.Count);

        var rawStatusBreakdown = await statusBreakdownTask;
        var mangaStatusBreakdown = rawStatusBreakdown
            .Where(x => !string.IsNullOrWhiteSpace(x.Status))
            .ToDictionary(x => x.Status!, x => (long)x.Count);

        var rawProviderBreakdown = await providerBreakdownTask;
        var providerChapterBreakdown = rawProviderBreakdown
            .Where(x => !string.IsNullOrWhiteSpace(x.Provider))
            .ToDictionary(x => x.Provider!, x => (long)x.Count);

        return new DashboardStatistic
        {
            TotalManga = totalManga,
            TotalChapters = totalChapters,
            TotalSourceProvider = totalSourceProvider,
            ScrappedToday = scrappedToday,
            ScrappedThisMonth = scrappedThisMonth,
            TotalUnlinkedMetadata = totalUnlinkedMetadata,
            TotalUnavailableMangaChapter = totalUnavailableMangaChapter,
            TotalStorageUsed = totalStorageUsed,
            MonthlyScrap = monthlyScrap,
            TotalUsers = totalUsers,
            ActiveUsersToday = activeUsersToday,
            ActiveUsersThisMonth = activeUsersThisMonth,
            MangaTypeBreakdown = mangaTypeBreakdown,
            MangaStatusBreakdown = mangaStatusBreakdown,
            ProviderChapterBreakdown = providerChapterBreakdown
        };
    }

    public async Task<(List<Manga> Items, int TotalCount)> GetTrendingAsync(string? search, List<string>? genres, string? status, string? type, int page, int pageSize,
        CancellationToken ct)
    {
        var builder = Builders<MangaDocument>.Filter;
        var filter = builder.Empty;

        if (!string.IsNullOrWhiteSpace(search))
        {
            filter &= builder.Regex(m => m.Title, new BsonRegularExpression(search, "i"));
        }

        if (genres != null && genres.Any())
        {
            filter &= builder.All(m => m.Genres, genres);
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            filter &= builder.Eq(m => m.Status, status);
        }

        if (!string.IsNullOrWhiteSpace(type))
        {
            filter &= builder.Eq(m => m.Type, type);
        }

        var twoWeeksAgo = DateTime.UtcNow.AddDays(-14);

        var pipeline = new List<BsonDocument>();

        // 1. Match base filter
        var matchStage = new BsonDocument("$match", filter.Render(new RenderArgs<MangaDocument>(dbContext.Mangas.DocumentSerializer, dbContext.Mangas.Settings.SerializerRegistry)));
        pipeline.Add(matchStage);

        // 2. AddFields stage to calculate TrendingViews
        var addFieldsStage = new BsonDocument("$addFields", new BsonDocument("TrendingViews",
            new BsonDocument("$sum",
                new BsonDocument("$map", new BsonDocument
                {
                    { "input", new BsonDocument("$filter", new BsonDocument
                        {
                            { "input", "$chapters" },
                            { "as", "c" },
                            { "cond", new BsonDocument("$gte", new BsonArray { "$$c.uploadDate", twoWeeksAgo }) }
                        })
                    },
                    { "as", "c" },
                    { "in", "$$c.totalView" }
                })
            )
        ));
        pipeline.Add(addFieldsStage);

        // 3. Match only documents with TrendingViews > 0
        var matchTrending = new BsonDocument("$match", new BsonDocument("TrendingViews", new BsonDocument("$gt", 0)));
        pipeline.Add(matchTrending);

        // 4. Facet for count and paginated data
        var facetStage = new BsonDocument("$facet", new BsonDocument
        {
            { "totalCount", new BsonArray { new BsonDocument("$count", "count") } },
            { "data", new BsonArray
                {
                    new BsonDocument("$sort", new BsonDocument { { "TrendingViews", -1 }, { "updatedAt", -1 } }),
                    new BsonDocument("$skip", (page - 1) * pageSize),
                    new BsonDocument("$limit", pageSize),
                    new BsonDocument("$project", new BsonDocument { { "chapters.pages", 0 }, { "TrendingViews", 0 } })
                }
            }
        });
        pipeline.Add(facetStage);

        var aggregationResult = await dbContext.Mangas.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).FirstOrDefaultAsync(ct);

        int totalCount = 0;
        var items = new List<Manga>();

        if (aggregationResult != null)
        {
            var totalCountArray = aggregationResult["totalCount"].AsBsonArray;
            if (totalCountArray.Count > 0)
            {
                totalCount = totalCountArray[0]["count"].AsInt32;
            }

            var dataArray = aggregationResult["data"].AsBsonArray;
            foreach (var doc in dataArray)
            {
                var mangaDoc = MongoDB.Bson.Serialization.BsonSerializer.Deserialize<MangaDocument>(doc.AsBsonDocument);
                items.Add(MapToDomain(mangaDoc));
            }
        }

        return (items, totalCount);
    }

    private static Manga MapToDomain(MangaDocument doc) => doc.Adapt<Manga>();

    private static MangaDocument MapToDocument(Manga manga) => manga.Adapt<MangaDocument>();

    private class ChapterDocumentUnwound
    {
        public ChapterDocument Chapters { get; set; } = null!;
    }
}
