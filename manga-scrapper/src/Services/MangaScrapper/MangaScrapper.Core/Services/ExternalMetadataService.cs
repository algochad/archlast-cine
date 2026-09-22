using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using NovaStack.Contracts.Responses;
using System.Net.Http.Json;
using System.Web;

namespace MangaScrapper.Core.Services;

public sealed class ExternalMetadataService : IExternalMetadataService
{
    private readonly HttpClient _httpClient;

    public ExternalMetadataService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<List<Manga>> SearchJikanAsync(string title, CancellationToken ct = default)
    {
        var query = HttpUtility.ParseQueryString(string.Empty);
        query["q"] = title;
        query["limit"] = "10";
        try
        {
            var response = await _httpClient.GetFromJsonAsync<JikanMangaResponse>($"https://api.jikan.moe/v4/manga?{query}", ct);
            var items = response?.Data ?? [];
            
            var result = new List<Manga>();
            foreach (var item in items)
            {
                var author = item.Authors?.FirstOrDefault()?.Name ?? "Unknown";
                var manga = Manga.Create(
                    title: item.Title ?? "Unknown",
                    author: author,
                    type: item.Type ?? "Unknown",
                    source: "Jikan",
                    malId: item.MalId,
                    genres: item.Genres?.Select(g => g.Name ?? "").Where(n => !string.IsNullOrEmpty(n)).ToList() ?? [],
                    description: item.Synopsis,
                    imageUrl: item.Images?.Jpg?.ImageUrl ?? item.Images?.Webp?.ImageUrl,
                    url: item.Url,
                    rating: item.Score,
                    status: item.Status
                );
                // Popularity, Members, ReleaseDate are missing in Create, we can use UpdateFromScrapper
                manga.UpdateFromScrapper(
                    malId: item.MalId,
                    rating: item.Score,
                    popularity: item.Popularity,
                    members: item.Members,
                    releaseDate: item.Published?.From,
                    status: item.Status,
                    author: author);
                result.Add(manga);
            }
            return result;
        }
        catch
        {
            return [];
        }
    }

    public async Task<List<Manga>> SearchAnilistAsync(string title, int? anilistId = null, CancellationToken ct = default)
    {
        var url = "https://graphql.anilist.co";
        object queryPayload = anilistId.HasValue
            ? new
            {
                query = @"
                    query ($id: Int) {
                        Page (page: 1, perPage: 10) {
                            media (id: $id, type: MANGA) {
                                id
                                idMal
                                title { romaji english native }
                                description
                                countryOfOrigin
                                format
                                status
                                chapters
                                volumes
                                coverImage { extraLarge large medium }
                                averageScore
                                popularity
                                favourites
                                genres
                                synonyms
                                tags { name rank }
                                startDate { year month day }
                                staff {
                                    edges {
                                        role
                                        node {
                                            name { full }
                                        }
                                    }
                                }
                            }
                        }
                    }",
                variables = new { id = anilistId.Value }
            }
            : new
            {
                query = @"
                    query ($search: String) {
                        Page (page: 1, perPage: 10) {
                            media (search: $search, type: MANGA) {
                                id
                                idMal
                                title { romaji english native }
                                description
                                countryOfOrigin
                                format
                                status
                                chapters
                                volumes
                                coverImage { extraLarge large medium }
                                averageScore
                                popularity
                                favourites
                                genres
                                synonyms
                                tags { name rank }
                                startDate { year month day }
                                staff {
                                    edges {
                                        role
                                        node {
                                            name { full }
                                        }
                                    }
                                }
                            }
                        }
                    }",
                variables = new { search = title }
            };

        try
        {
            var response = await _httpClient.PostAsJsonAsync(url, queryPayload, ct);
            response.EnsureSuccessStatusCode();
            var result = await response.Content.ReadFromJsonAsync<AnilistResponse>(cancellationToken: ct);
            var items = result?.Data?.Page?.Media ?? [];
            
            var mangaList = new List<Manga>();
            foreach (var item in items)
            {
                var titleToUse = (item.ComicType == ComicType.Manga
                    ? item.Title?.Romaji
                    : item.Title?.English ?? item.Title?.Romaji ?? item.Title?.Native) ?? "Unknown";
                
                var author = "Unknown";
                var staffEdges = item.Staff?.Edges;
                if (staffEdges != null && staffEdges.Any())
                {
                    var mainAuthor = staffEdges.FirstOrDefault(e => e.Role != null && (e.Role.Contains("Story") || e.Role.Contains("Art") || e.Role.Contains("Original Creator")));
                    if (mainAuthor != null && mainAuthor.Node?.Name?.Full != null)
                    {
                        author = mainAuthor.Node.Name.Full;
                    }
                    else if (staffEdges.First().Node?.Name?.Full != null)
                    {
                        author = staffEdges.First().Node!.Name!.Full!;
                    }
                }

                var synonyms = (item.Synonyms ?? [])
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                var mangaEnglishTitleAlternative = item.ComicType == ComicType.Manga ? item.Title?.English : null;
                if (!string.IsNullOrWhiteSpace(mangaEnglishTitleAlternative) && !synonyms.Contains(mangaEnglishTitleAlternative, StringComparer.OrdinalIgnoreCase))
                {
                    synonyms.Add(mangaEnglishTitleAlternative);
                }

                var mediaWithCleanedSynonyms = item with { Synonyms = synonyms };

                var manga = Manga.Create(
                    title: titleToUse,
                    author: author,
                    type: item.ComicType.ToString(),
                    source: "Anilist",
                    malId: item.IdMal ?? 0,
                    anilistId: item.Id,
                    synonyms: synonyms,
                    genres: item.Genres ?? [],
                    categories: item.Tags?.Select(t => t.Name).Where(n => !string.IsNullOrEmpty(n)).Cast<string>().ToList() ?? [],
                    description: item.Description,
                    imageUrl: item.CoverImage?.Large ?? item.CoverImage?.Medium ?? item.CoverImage?.ExtraLarge,
                    rating: item.AverageScore.HasValue ? item.AverageScore.Value / 10.0 : null,
                    status: item.Status
                );
                manga.ReconstituteFromAnilist(mediaWithCleanedSynonyms);
                mangaList.Add(manga);
            }
            return mangaList;
        }
        catch
        {
            return [];
        }
    }

    public async Task<JikanMangaItem?> GetJikanMangaInfoAsync(string title, string type, CancellationToken ct = default)
    {
        var query = HttpUtility.ParseQueryString(string.Empty);
        query["q"] = title;
        query["limit"] = "10";
        try
        {
            var response = await _httpClient.GetFromJsonAsync<JikanMangaResponse>($"https://api.jikan.moe/v4/manga?{query}", ct);
            var results = response?.Data ?? [];
            return results.FirstOrDefault(x => string.Equals(x.Type, type, StringComparison.OrdinalIgnoreCase)) ?? results.FirstOrDefault();
        }
        catch
        {
            return null;
        }
    }

    public async Task<JikanMangaItem?> GetJikanMangaInfoByIdAsync(int malId, CancellationToken ct = default)
    {
        try
        {
            var response = await _httpClient.GetFromJsonAsync<JikanMangaSingleResponse>($"https://api.jikan.moe/v4/manga/{malId}", ct);
            return response?.Data;
        }
        catch
        {
            return null;
        }
    }

    public async Task<List<Manga>> SearchMangaUpdatesAsync(string title, int? mangaUpdateId = null, CancellationToken ct = default)
    {
        try
        {
            if (mangaUpdateId != null)
            {
                try
                {
                    var details = await _httpClient.GetFromJsonAsync<MangaUpdatesSeriesResponse>($"https://api.mangaupdates.com/v1/series/{mangaUpdateId}", ct);
                    if (details != null)
                    {
                        var author = details.Authors?.FirstOrDefault(a => a.Type == "Author")?.Name ?? details.Authors?.FirstOrDefault()?.Name ?? "Unknown";
                        var categories = details.Categories?.OrderByDescending(x => x.Votes).Select(c => c.Category).Where(c => !string.IsNullOrEmpty(c)).Cast<string>().ToList();
                        var genres = details.Genres?.Select(g => g.Genre).Where(g => !string.IsNullOrEmpty(g)).Cast<string>().ToList() ?? new List<string>();

                        DateTime? releaseDate = null;
                        if (!string.IsNullOrEmpty(details.Year) && int.TryParse(details.Year, out int year))
                        {
                            releaseDate = new DateTime(year, 1, 1);
                        }

                        var manga = Manga.Create(
                            title: details.Title ?? title,
                            author: author,
                            type: details.Type ?? "Unknown",
                            source: "MangaUpdates",
                            malId: 0,
                            anilistId: null,
                            mangaUpdateId: details.SeriesId ?? mangaUpdateId,
                            genres: genres,
                            categories: categories,
                            description: details.Description,
                            imageUrl: details.Image?.Url?.Original ?? details.Image?.Url?.Thumb,
                            rating: details.BayesianRating,
                            status: details.Completed ? "Completed" : "Ongoing",
                            releaseDate: releaseDate
                        );

                        return [manga];
                    }
                }
                catch
                {
                    // Fallback to title search if direct id lookup fails
                }
            }

            var query = new { search = title, perpage = 10 };
            var response = await _httpClient.PostAsJsonAsync("https://api.mangaupdates.com/v1/series/search", query, ct);
            response.EnsureSuccessStatusCode();
            var result = await response.Content.ReadFromJsonAsync<MangaUpdatesSearchResponse>(cancellationToken: ct);
            var items = result?.Results?.Take(10).ToList() ?? [];

            var detailTasks = items.Where(i => i.Record?.SeriesId != null).Select(async item =>
            {
                var record = item.Record!;
                
                MangaUpdatesSeriesResponse? details = null;
                try
                {
                    details = await _httpClient.GetFromJsonAsync<MangaUpdatesSeriesResponse>($"https://api.mangaupdates.com/v1/series/{record.SeriesId}", ct);
                }
                catch
                {
                    // Ignore detail fetch errors
                }

                var author = details?.Authors?.FirstOrDefault(a => a.Type == "Author")?.Name ?? "Unknown";
                var categories = new List<string>();
                if (details.Categories.Count > 15 && details.Categories.Max(x=>x.Votes)>5)
                {
                    categories= details?.Categories?
                        .Where(x=>x.Votes>1)
                        .OrderByDescending(x=>x.Votes)
                        .Select(c => c.Category)
                        .Where(c => !string.IsNullOrEmpty(c))
                        .Cast<string>()
                        .ToList();
                }
                else
                {
                    categories= details?.Categories?
                        .OrderByDescending(x=>x.Votes)
                        .Select(c => c.Category)
                        .Where(c => !string.IsNullOrEmpty(c))
                        .Cast<string>()
                        .ToList();
                }
                 
                var genres = record.Genres?.Select(g => g.Genre).Where(g => !string.IsNullOrEmpty(g)).Cast<string>().ToList() ?? new List<string>();

                DateTime? releaseDate = null;
                if (!string.IsNullOrEmpty(record.Year) && int.TryParse(record.Year, out int year))
                {
                    releaseDate = new DateTime(year, 1, 1);
                }

                return Manga.Create(
                    title: record.Title ?? "Unknown",
                    author: author,
                    type: record.Type ?? "Unknown",
                    source: "MangaUpdates",
                    malId: 0,
                    anilistId: null,
                    mangaUpdateId:record.SeriesId,
                    genres: genres,
                    categories: categories,
                    description: record.Description,
                    imageUrl: record.Image?.Url?.Original ?? record.Image?.Url?.Thumb,
                    rating: record.BayesianRating,
                    status: details?.Completed == true ? "Completed" : "Ongoing",
                    releaseDate: releaseDate
                );
            });

            var mangaList = await Task.WhenAll(detailTasks);
            return mangaList.ToList();
        }
        catch
        {
            return new List<Manga>();
        }
    }
}
