using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Persistence.Documents;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using NovaStack.Contracts.Responses;

namespace MangaScrapper.Core.Common.Mappings;

public sealed class MangaMappingConfig : IRegister
{
    public void Register(TypeAdapterConfig config)
    {
        // ── Value Object Primitive Mappings ──────────────────────────────────
        config.NewConfig<Guid, MangaId>().MapWith(guid => MangaId.From(guid));
        config.NewConfig<MangaId, Guid>().MapWith(id => id.Value);

        config.NewConfig<Guid, ChapterId>().MapWith(guid => ChapterId.From(guid));
        config.NewConfig<ChapterId, Guid>().MapWith(id => id.Value);

        config.NewConfig<Guid, UserId>().MapWith(guid => UserId.From(guid));
        config.NewConfig<UserId, Guid>().MapWith(id => id.Value);

        // ── DTO & Contract Mappings ─────────────────────────────────────────
        config.NewConfig<Manga, MangaSummaryResponse>()
            .Map(dest => dest.Id, src => src.Id.Value)
            .Map(dest => dest.TotalView, src => src.Chapters.Count == 1 ? src.TotalView : src.Chapters.Sum(x => x.TotalView))
            .Map(dest => dest.LatestChapter, src => src.Chapters.OrderByDescending(c => c.Number).FirstOrDefault().Adapt<ChapterResponse>());

        config.NewConfig<Chapter, ChapterResponse>()
            .Map(dest => dest.Id, src => src.Id.Value)
            .Map(dest => dest.TotalPages, src => src.Pages.Count)
            .Map(dest => dest.BrokenPageCount, src => src.BrokenPageCount)
            .Ignore(dest => dest.Pages);

        config.NewConfig<Chapter, MeiliChapterDocument>()
            .Map(dest => dest.Id, src => src.Id.Value.ToString())
            .Map(dest => dest.UploadDateTimestamp, src => ((DateTimeOffset)src.UploadDate.ToUniversalTime()).ToUnixTimeSeconds());

        config.NewConfig<Manga, MeiliMangaDocument>()
            .Map(dest => dest.Id, src => src.Id.Value.ToString())
            .Map(dest => dest.ReleaseDate, src => ((DateTimeOffset)src.ReleaseDate.GetValueOrDefault().ToUniversalTime()).ToUnixTimeSeconds())
            .Map(dest => dest.CreatedAtTimestamp, src => ((DateTimeOffset)src.CreatedAt.ToUniversalTime()).ToUnixTimeSeconds())
            .Map(dest => dest.UpdatedAtTimestamp, src => ((DateTimeOffset)src.UpdatedAt.ToUniversalTime()).ToUnixTimeSeconds())
            .Map(dest => dest.TotalView, src => src.Chapters.Sum(x => x.TotalView))
            .Map(dest => dest.TotalChapters, src => src.Chapters.Count)
            .Map(dest => dest.LatestChapterNumber, src => src.Chapters.Count > 0 ? src.Chapters.Max(c => c.Number) : 0)
            .Map(dest => dest.LatestChapter, src => src.Chapters.OrderByDescending(c => c.Number).FirstOrDefault().Adapt<MeiliChapterDocument>());

        config.NewConfig<MeiliMangaDocument, Manga>()
            .Map(dest => dest.Id, src => MangaId.From(Guid.Parse(src.Id)))
            .Map(dest => dest.ReleaseDate, src => src.ReleaseDate > 0 ? DateTimeOffset.FromUnixTimeSeconds(src.ReleaseDate).UtcDateTime : (DateTime?)null)
            .Map(dest => dest.CreatedAt, src => src.CreatedAtTimestamp > 0 ? DateTimeOffset.FromUnixTimeSeconds(src.CreatedAtTimestamp).UtcDateTime : DateTime.UtcNow)
            .Map(dest => dest.UpdatedAt, src => src.UpdatedAtTimestamp > 0 ? DateTimeOffset.FromUnixTimeSeconds(src.UpdatedAtTimestamp).UtcDateTime : DateTime.UtcNow)
            .ConstructUsing(doc => Manga.Reconstitute(
                MangaId.From(Guid.Parse(doc.Id)),
                doc.Title,
                doc.Author,
                doc.Type,
                doc.MalId,
                doc.AnilistId,
                doc.MangaUpdateId,
                doc.Synonyms,
                doc.Genres,
                doc.Categories,
                doc.Description,
                doc.ImageUrl,
                doc.LocalImageUrl,
                0,
                doc.Rating,
                doc.Popularity,
                doc.Members,
                doc.Nsfw,
                doc.Status,
                doc.ReleaseDate > 0 ? DateTimeOffset.FromUnixTimeSeconds(doc.ReleaseDate).UtcDateTime : null,
                doc.TotalView,
                doc.CreatedAtTimestamp > 0 ? DateTimeOffset.FromUnixTimeSeconds(doc.CreatedAtTimestamp).UtcDateTime : DateTime.UtcNow,
                doc.UpdatedAtTimestamp > 0 ? DateTimeOffset.FromUnixTimeSeconds(doc.UpdatedAtTimestamp).UtcDateTime : DateTime.UtcNow,
                doc.Url,
                doc.LatestChapter != null && !string.IsNullOrWhiteSpace(doc.LatestChapter.Id)
                    ? new List<Chapter>
                    {
                        new Chapter(
                            ChapterId.From(Guid.Parse(doc.LatestChapter.Id)),
                            doc.LatestChapter.Number,
                            doc.LatestChapter.Link,
                            doc.LatestChapter.ChapterProvider,
                            doc.LatestChapter.ChapterProviderIcon,
                            doc.LatestChapter.Language,
                            doc.LatestChapter.TotalView,
                            doc.LatestChapter.UploadDateTimestamp > 0 ? DateTimeOffset.FromUnixTimeSeconds(doc.LatestChapter.UploadDateTimestamp).UtcDateTime : DateTime.UtcNow,
                            null
                        )
                    }
                    : new List<Chapter>()
            ));

        // ── Persistence BSON Document Mappings ─────────────────────────────
        config.NewConfig<MangaDocument, Manga>()
            .Map(dest => dest.Id, src => MangaId.From(src.Id))
            .Map(dest => dest.Synonyms, src => src.Synonyms ?? new List<string>())
            .Map(dest => dest.Genres, src => src.Genres ?? new List<string>())
            .Map(dest => dest.Categories, src => src.Categories ?? new List<string>())
            .ConstructUsing(doc => Manga.Reconstitute(
                MangaId.From(doc.Id),
                doc.Title,
                doc.Author,
                doc.Type,
                doc.MalId,
                doc.AnilistId,
                doc.MangaUpdateId,
                doc.Synonyms,
                doc.Genres,
                doc.Categories,
                doc.Description,
                doc.ImageUrl,
                doc.LocalImageUrl,
                doc.ThumbnailSize,
                doc.Rating,
                doc.Popularity,
                doc.Members,
                doc.Nsfw,
                doc.Status,
                doc.ReleaseDate,
                doc.TotalView,
                doc.CreatedAt,
                doc.UpdatedAt,
                doc.Url,
                doc.Chapters != null ? doc.Chapters.Select(c => new Chapter(
                    ChapterId.From(c.Id),
                    c.Number,
                    c.Link,
                    c.ChapterProvider,
                    c.ChapterProviderIcon,
                    c.Language,
                    c.TotalView,
                    c.UploadDate,
                    c.Pages != null ? c.Pages.Select(p => new Page(p.Id, p.ImageUrl, p.LocalImageUrl, p.Size, p.Width, p.Height, p.IsFallback)).ToList() : null
                )).ToList() : null));

        config.NewConfig<Manga, MangaDocument>()
            .Map(dest => dest.Id, src => src.Id.Value)
            .Map(dest => dest.MalId, src => src.MalId)
            .Map(dest => dest.Chapters, src => src.Chapters.Select(c => new ChapterDocument
            {
                Id = c.Id.Value,
                Number = c.Number,
                Link = c.Link,
                ChapterProvider = c.ChapterProvider,
                ChapterProviderIcon = c.ChapterProviderIcon,
                Language = c.Language,
                TotalView = c.TotalView,
                UploadDate = c.UploadDate,
                Pages = c.Pages.Select(p => new PageDocument
                {
                    Id = p.Id,
                    ImageUrl = p.ImageUrl,
                    LocalImageUrl = p.LocalImageUrl,
                    Size = p.Size,
                    Width = p.Width,
                    Height = p.Height,
                    IsFallback = p.IsFallback
                }).ToList()
            }).ToList());
    }
}
