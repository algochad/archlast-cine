using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Persistence;
using MangaScrapper.Core.Persistence.Documents;
using Mapster;
using Meilisearch;
using MongoDB.Driver;
using NovaStack.Contracts.Requests;

namespace MangaScrapper.Core.Services;

public class MeilisearchService
{
    private const string IndexName = "mangas";
    private readonly MeilisearchClient _client;
    private readonly MangaMongoDbContext _dbContext;
    private readonly ILogger<MeilisearchService> _logger;

    public MeilisearchService(
        IOptions<MeiliConfig> config,
        MangaMongoDbContext dbContext,
        ILogger<MeilisearchService> logger)
    {
        _client = new MeilisearchClient(config.Value.Host, config.Value.MasterKey);
        _dbContext = dbContext;
        _logger = logger;
    }

    /// <summary>
    /// Creates or gets the mangas index and configures searchable/filterable attributes.
    /// </summary>
    public async Task InitializeAsync(CancellationToken ct = default)
    {
        _logger.LogInformation("Initializing Meilisearch index '{IndexName}'...", IndexName);

        var task = await _client.CreateIndexAsync(IndexName, "id", ct);
        await _client.WaitForTaskAsync(task.TaskUid, cancellationToken: ct);

        var index = _client.Index(IndexName);

        await index.UpdateSearchableAttributesAsync(new[]
        {
            "title",
            "synonyms",
            "author",
            "description",
            "genres"
        }, ct);

        await index.UpdateFilterableAttributesAsync(new[]
        {
            "type",
            "status",
            "genres",
            "categories",
            "rating",
            "popularity",
            "members",
            "totalView",
            "releaseDate",
            "nsfw",
            "author",
            "totalChapters",
            "latestChapterNumber",
            "createdAtTimestamp",
            "updatedAtTimestamp",
            "anilistId",
            "malId",
            "mangaUpdateId"
        }, ct);

        await index.UpdateSortableAttributesAsync(new[]
        {
            "title",
            "rating",
            "popularity",
            "members",
            "totalView",
            "releaseDate",
            "totalChapters",
            "latestChapterNumber",
            "createdAtTimestamp",
            "updatedAtTimestamp"
        }, ct);

        _logger.LogInformation("Meilisearch index '{IndexName}' initialized successfully.", IndexName);
    }

    /// <summary>
    /// Fetches all manga from MongoDB and syncs them to the Meilisearch index.
    /// </summary>
    public async Task SyncAllAsync(CancellationToken ct = default)
    {
        _logger.LogInformation("Starting full sync from MongoDB to Meilisearch...");

        await InitializeAsync(ct);

        long totalCount = await _dbContext.Mangas.CountDocumentsAsync(_ => true, cancellationToken: ct);
        if (totalCount == 0)
        {
            _logger.LogWarning("No manga documents found in MongoDB. Nothing to sync.");
            return;
        }

        var index = _client.Index(IndexName);
        var projection = Builders<MangaDocument>.Projection.Exclude("Chapters.pages");

        using var cursor = await _dbContext.Mangas
            .Find(_ => true)
            .Project<MangaDocument>(projection)
            .ToCursorAsync(ct);

        int processed = 0;
        var batch = new List<MeiliMangaDocument>();

        while (await cursor.MoveNextAsync(ct))
        {
            foreach (var doc in cursor.Current)
            {
                batch.Add(doc.Adapt<Manga>().Adapt<MeiliMangaDocument>());
                
                if (batch.Count >= 1000)
                {
                    var task = await index.AddDocumentsAsync(batch, "id", ct);
                    await _client.WaitForTaskAsync(task.TaskUid, cancellationToken: ct);
                    processed += batch.Count;
                    _logger.LogInformation("Indexed {Processed} of {Total} documents.", processed, totalCount);
                    batch.Clear();
                }
            }
        }

        if (batch.Count > 0)
        {
            var task = await index.AddDocumentsAsync(batch, "id", ct);
            await _client.WaitForTaskAsync(task.TaskUid, cancellationToken: ct);
            processed += batch.Count;
            _logger.LogInformation("Indexed {Processed} of {Total} documents.", processed, totalCount);
        }

        _logger.LogInformation("Full sync completed. {Count} manga documents indexed.", processed);
    }

    /// <summary>
    /// Indexes a single manga (for real-time sync after create/update).
    /// </summary>
    public async Task IndexMangaAsync(Manga manga, CancellationToken ct = default)
    {
        var document = manga.Adapt<MeiliMangaDocument>();
        var index = _client.Index(IndexName);
        var task = await index.AddDocumentsAsync(new[] { document }, "id", ct);
        await _client.WaitForTaskAsync(task.TaskUid, cancellationToken: ct);

        _logger.LogInformation("Indexed manga '{Title}' (ID: {Id}) to Meilisearch.", manga.Title, manga.Id.Value);
    }

    /// <summary>
    /// Removes a manga from the Meilisearch index.
    /// </summary>
    public async Task DeleteMangaAsync(Guid id, CancellationToken ct = default)
    {
        var index = _client.Index(IndexName);
        var task = await index.DeleteOneDocumentAsync(id.ToString(), ct);
        await _client.WaitForTaskAsync(task.TaskUid, cancellationToken: ct);

        _logger.LogInformation("Deleted manga (ID: {Id}) from Meilisearch index.", id);
    }

    public async Task<MeiliMangaDocument?> SearchTitleAsync(string title, CancellationToken ct = default)
    {
        var index = _client.Index(IndexName);
        var searchQuery = new SearchQuery
        {
            AttributesToHighlight = new[] { "title" },
            ShowRankingScore = true,
            HitsPerPage = 1,
            Page = 1
        };

        var result = await index.SearchAsync<MeiliMangaDocument>(title, searchQuery, ct);
        return result.Hits.FirstOrDefault();
    }

    /// <summary>
    /// Searches the Meilisearch index with filters, sorting, and pagination.
    /// </summary>
    public async Task<(List<MeiliMangaDocument> Items, int TotalCount)> SearchAsync(
        string? search,
        List<string>? genres,
        string? status,
        string? type,
        string sortBy,
        string orderBy,
        int page,
        int pageSize,
        bool? nsfw = null,
        CancellationToken ct = default)
    {
        var index = _client.Index(IndexName);

        // Build filter expressions
        var filters = new List<string>();

        if (genres != null && genres.Count > 0)
        {
            foreach (var genre in genres)
            {
                filters.Add($"genres = \"{genre}\"");
            }
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            filters.Add($"status = \"{status}\"");
        }

        if (!string.IsNullOrWhiteSpace(type))
        {
            filters.Add($"type = \"{type}\"");
        }

        if (nsfw.HasValue)
        {
            filters.Add($"nsfw = {nsfw.Value.ToString().ToLowerInvariant()}");
        }

        // Map sortBy to Meilisearch sort field
        var meiliSortField = MapSortField(sortBy);
        var sortDirection = orderBy?.ToLowerInvariant() == "asc" ? "asc" : "desc";

        var searchQuery = new SearchQuery
        {
            Filter = filters.Count > 0 ? string.Join(" AND ", filters) : null,
            Sort = new[] { $"{meiliSortField}:{sortDirection}" },
            HitsPerPage = pageSize,
            Page = page
        };

        var result = await index.SearchAsync<MeiliMangaDocument>(search ?? "", searchQuery, ct);

        var paginated = result as PaginatedSearchResult<MeiliMangaDocument>;
        var totalHits = paginated?.TotalHits ?? 0;

        return (result.Hits.ToList(), totalHits);
    }

    /// <summary>
    /// Searches the Meilisearch index with advanced filters, multi-field sorting, and pagination.
    /// </summary>
    public async Task<(List<MeiliMangaDocument> Items, int TotalCount)> AdvancedSearchAsync(
        MangaAdvancedFilter? filter,
        List<MangaSortOption>? sorts,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        var index = _client.Index(IndexName);

        var filters = new List<string>();

        if (filter != null)
        {
            // Included genres
            if (filter.IncludedGenres is { Count: > 0 })
            {
                var cleanGenres = filter.IncludedGenres.Where(g => !string.IsNullOrWhiteSpace(g)).ToList();
                if (cleanGenres.Count > 0)
                {
                    var isOrMode = string.Equals(filter.GenreMatchMode, "Or", StringComparison.OrdinalIgnoreCase);
                    var genreClauses = cleanGenres.Select(g => $"genres = \"{EscapeMeiliString(g)}\"");
                    if (isOrMode)
                    {
                        filters.Add($"({string.Join(" OR ", genreClauses)})");
                    }
                    else
                    {
                        foreach (var clause in genreClauses)
                        {
                            filters.Add(clause);
                        }
                    }
                }
            }

            // Excluded genres
            if (filter.ExcludedGenres is { Count: > 0 })
            {
                foreach (var g in filter.ExcludedGenres.Where(g => !string.IsNullOrWhiteSpace(g)))
                {
                    filters.Add($"genres != \"{EscapeMeiliString(g)}\"");
                }
            }

            // Statuses
            if (filter.Statuses is { Count: > 0 })
            {
                var cleanStatuses = filter.Statuses.Where(s => !string.IsNullOrWhiteSpace(s)).ToList();
                if (cleanStatuses.Count == 1)
                {
                    filters.Add($"status = \"{EscapeMeiliString(cleanStatuses[0])}\"");
                }
                else if (cleanStatuses.Count > 1)
                {
                    var statusClauses = cleanStatuses.Select(s => $"status = \"{EscapeMeiliString(s)}\"");
                    filters.Add($"({string.Join(" OR ", statusClauses)})");
                }
            }

            // Types
            if (filter.Types is { Count: > 0 })
            {
                var cleanTypes = filter.Types.Where(t => !string.IsNullOrWhiteSpace(t)).ToList();
                if (cleanTypes.Count == 1)
                {
                    filters.Add($"type = \"{EscapeMeiliString(cleanTypes[0])}\"");
                }
                else if (cleanTypes.Count > 1)
                {
                    var typeClauses = cleanTypes.Select(t => $"type = \"{EscapeMeiliString(t)}\"");
                    filters.Add($"({string.Join(" OR ", typeClauses)})");
                }
            }

            // Author
            if (!string.IsNullOrWhiteSpace(filter.Author))
            {
                filters.Add($"author = \"{EscapeMeiliString(filter.Author)}\"");
            }

            // Rating
            if (filter.MinRating.HasValue && filter.MaxRating.HasValue)
            {
                filters.Add($"rating >= {filter.MinRating.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)} AND rating <= {filter.MaxRating.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)}");
            }
            else if (filter.MinRating.HasValue)
            {
                filters.Add($"rating >= {filter.MinRating.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)}");
            }
            else if (filter.MaxRating.HasValue)
            {
                filters.Add($"rating <= {filter.MaxRating.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)}");
            }

            // Popularity
            if (filter.MinPopularity.HasValue)
            {
                filters.Add($"popularity >= {filter.MinPopularity.Value}");
            }
            if (filter.MaxPopularity.HasValue)
            {
                filters.Add($"popularity <= {filter.MaxPopularity.Value}");
            }

            // TotalView
            if (filter.MinTotalView.HasValue)
            {
                filters.Add($"totalView >= {filter.MinTotalView.Value}");
            }
            if (filter.MaxTotalView.HasValue)
            {
                filters.Add($"totalView <= {filter.MaxTotalView.Value}");
            }

            // TotalChapters
            if (filter.MinChapters.HasValue)
            {
                filters.Add($"totalChapters >= {filter.MinChapters.Value}");
            }
            if (filter.MaxChapters.HasValue)
            {
                filters.Add($"totalChapters <= {filter.MaxChapters.Value}");
            }

            // ReleaseDate Range
            if (filter.StartReleaseDate.HasValue)
            {
                var startSec = ((DateTimeOffset)filter.StartReleaseDate.Value.ToUniversalTime()).ToUnixTimeSeconds();
                filters.Add($"releaseDate >= {startSec}");
            }
            if (filter.EndReleaseDate.HasValue)
            {
                var endSec = ((DateTimeOffset)filter.EndReleaseDate.Value.ToUniversalTime()).ToUnixTimeSeconds();
                filters.Add($"releaseDate <= {endSec}");
            }

            // NSFW
            if (filter.Nsfw.HasValue)
            {
                filters.Add($"nsfw = {filter.Nsfw.Value.ToString().ToLowerInvariant()}");
            }

            // Anilist / Unlinked Metadata
            if (filter.UnlinkedAnilist == true || (filter.AnilistId.HasValue && filter.AnilistId.Value == 0))
            {
                filters.Add("(anilistId IS NULL OR anilistId = 0 OR anilistId NOT EXISTS)");
            }
            else if (filter.UnlinkedAnilist == false)
            {
                filters.Add("(anilistId IS NOT NULL AND anilistId > 0)");
            }
            else if (filter.AnilistId.HasValue && filter.AnilistId.Value > 0)
            {
                filters.Add($"anilistId = {filter.AnilistId.Value}");
            }
        }

        // Sorting
        var sortExpressions = new List<string>();
        if (sorts is { Count: > 0 })
        {
            foreach (var sort in sorts.Where(s => !string.IsNullOrWhiteSpace(s.Field)))
            {
                var field = MapSortField(sort.Field);
                var dir = string.Equals(sort.Direction, "asc", StringComparison.OrdinalIgnoreCase) ? "asc" : "desc";
                sortExpressions.Add($"{field}:{dir}");
            }
        }

        if (sortExpressions.Count == 0)
        {
            sortExpressions.Add("updatedAtTimestamp:desc");
        }

        var searchQuery = new SearchQuery
        {
            Filter = filters.Count > 0 ? string.Join(" AND ", filters) : null,
            Sort = sortExpressions,
            HitsPerPage = pageSize > 0 ? pageSize : 10,
            Page = page > 0 ? page : 1
        };

        var result = await index.SearchAsync<MeiliMangaDocument>(filter?.Search ?? "", searchQuery, ct);

        var paginated = result as PaginatedSearchResult<MeiliMangaDocument>;
        var totalHits = paginated?.TotalHits ?? 0;

        return (result.Hits.ToList(), totalHits);
    }

    private static string EscapeMeiliString(string value) => value.Replace("\"", "\\\"");

    private static string MapSortField(string sortBy) => sortBy.ToLowerInvariant() switch
    {
        "title" => "title",
        "rating" => "rating",
        "popularity" => "popularity",
        "members" => "members",
        "totalview" or "views" or "view" => "totalView",
        "releasedate" or "release_date" or "year" => "releaseDate",
        "totalchapters" or "chapters" => "totalChapters",
        "latestchapternumber" or "latestchapter" or "chapter" => "latestChapterNumber",
        "createdat" or "created_at" or "createdattimestamp" => "createdAtTimestamp",
        _ => "updatedAtTimestamp" // default: updatedAt
    };
}
