using FluentAssertions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.DomainEvents;
using MangaScrapper.Core.ValueObjects;
using Xunit;

namespace UnitTests.MangaScrapper.Domain;

public class MangaAggregateTests
{
    [Fact]
    public void Create_WithValidArguments_ShouldInstantiateMangaAndRaiseDomainEvent()
    {
        // Arrange
        var title = "One Piece";
        var author = "Eiichiro Oda";
        var type = "Manga";
        var source = MangaSource.Komiku;

        // Act
        var manga = Manga.Create(title, author, type, source: "Komiku");

        // Assert
        manga.Should().NotBeNull();
        manga.Title.Should().Be(title);
        manga.Author.Should().Be(author);
        manga.Type.Should().Be(type);
        manga.DomainEvents.Should().ContainSingle(e => e is MangaCreatedDomainEvent);
    }

    [Fact]
    public void Reconstitute_ShouldHydrateMangaWithoutRaisingDomainEvents()
    {
        // Arrange
        var id = MangaId.New();
        var title = "Naruto";
        var author = "Masashi Kishimoto";
        var type = "Manga";

        // Act
        var manga = Manga.Reconstitute(
            id,
            title,
            author,
            type,
            malId: 20,
            anilistId:30,
            mangaUpdateId:23,
            synonyms: new List<string> { "Alternative Naruto" },
            genres: new List<string> { "Action", "Ninja" },
            categories:new List<string>{"Isekai"},
            description: "A ninja's journey",
            imageUrl: "http://example.com/cover.jpg",
            localImageUrl: "cover.webp",
            thumbnailSize: 1024,
            rating: 8.5,
            popularity: 10,
            members: 5000,
            nsfw:false,
            status: "Completed",
            releaseDate: DateTime.UtcNow.AddYears(-15),
            totalView: 100000,
            createdAt: DateTime.UtcNow.AddYears(-5),
            updatedAt: DateTime.UtcNow,
            url: "http://example.com/manga",
            chapters: null);

        // Assert
        manga.Should().NotBeNull();
        manga.Id.Should().Be(id);
        manga.Title.Should().Be(title);
        manga.Synonyms.Should().ContainSingle().Which.Should().Be("Alternative Naruto");
        manga.DomainEvents.Should().BeEmpty();
    }

    [Fact]
    public void UpdateFromAnilist_ShouldMergeSynonyms()
    {
        // Arrange
        var manga = Manga.Create("Attack on Titan", "Hajime Isayama", "Manga", "Komiku", synonyms: new List<string> { "AoT" });
        var other = Manga.Create("Shingeki no Kyojin", "Hajime Isayama", "Manga", "Anilist", synonyms: new List<string> { "SNK", "AoT" });

        // Act
        manga.UpdateFromAnilist(other);

        // Assert
        manga.Synonyms.Should().BeEquivalentTo(new List<string> { "AoT", "SNK" });
    }

    [Fact]
    public void UpdateFromAnilist_WhenCollectionsAreNull_ShouldMergeWithoutException()
    {
        // Arrange
        var manga = Manga.Reconstitute(
            MangaId.New(), "Bleach", "Tite Kubo", "Manga", 0, null, null,
            synonyms: null, genres: null, categories: null,
            description: null, imageUrl: null, localImageUrl: null,
            thumbnailSize: 0, rating: null, popularity: 0, members: 0,
            nsfw: false, status: null, releaseDate: null, totalView: 0,
            createdAt: DateTime.UtcNow, updatedAt: DateTime.UtcNow, url: null, chapters: null);

        var other = Manga.Create("Bleach", "Tite Kubo", "Manga", "Anilist",
            synonyms: new List<string> { "Bleach TYBW" },
            genres: new List<string> { "Action", "Supernatural" },
            categories: new List<string> { "Shounen" });

        // Act
        var act = () => manga.UpdateFromAnilist(other);

        // Assert
        act.Should().NotThrow();
        manga.Synonyms.Should().Contain("Bleach TYBW");
        manga.Genres.Should().Contain(new[] { "Action", "Supernatural" });
        manga.Categories.Should().Contain("Shounen");
    }

    [Fact]
    public void UpdateFromAnilist_ShouldExcludeEmptyOrWhitespaceSynonyms()
    {
        // Arrange
        var manga = Manga.Create("Naruto", "Masashi Kishimoto", "Manga", "Komiku", synonyms: new List<string> { "Naruto Shippuden" });
        var other = Manga.Create("Naruto", "Masashi Kishimoto", "Manga", "Anilist", synonyms: new List<string> { "", "   ", "Naruto: Shippuden", null! });

        // Act
        manga.UpdateFromAnilist(other);

        // Assert
        manga.Synonyms.Should().BeEquivalentTo(new List<string> { "Naruto Shippuden", "Naruto: Shippuden" });
        manga.Synonyms.Should().NotContain("");
        manga.Synonyms.Should().NotContain("   ");
    }

    [Fact]
    public void ReconstituteFromAnilist_ShouldExcludeEmptyOrWhitespaceSynonyms()
    {
        // Arrange
        var manga = Manga.Create("Naruto", "Masashi Kishimoto", "Manga", "Komiku", synonyms: new List<string> { "Naruto Shippuden" });
        var anilistMedia = new NovaStack.Contracts.Responses.AnilistMedia(
            Id: 123,
            IdMal: 456,
            Title: new NovaStack.Contracts.Responses.AnilistTitle("Naruto", "Naruto English", "ナルト"),
            Description: "A ninja story",
            CountryOfOrigin: "JP",
            Format: "MANGA",
            Status: "FINISHED",
            Chapters: 700,
            Volumes: 72,
            CoverImage: null,
            AverageScore: 80,
            Popularity: 1000,
            Favorites: 500,
            Genres: new List<string> { "Action" },
            Synonyms: new List<string> { "", "  ", "Naruto: Shippuden" },
            Tags: null,
            StartDate: null,
            Staff: null
        );

        // Act
        manga.ReconstituteFromAnilist(anilistMedia);

        // Assert
        manga.Synonyms.Should().BeEquivalentTo(new List<string> { "Naruto Shippuden", "Naruto: Shippuden" });
        manga.Synonyms.Should().NotContain("");
        manga.Synonyms.Should().NotContain("  ");
    }

    [Fact]
    public void Page_ShouldStoreWidthAndHeight_AndUpdateCorrectly()
    {
        // Arrange
        var pageId = Guid.NewGuid();
        var page = new Page(pageId, "https://example.com/img1.jpg", "manga/1/1.webp", 12345, 800, 1200);

        // Assert initial
        page.Id.Should().Be(pageId);
        page.ImageUrl.Should().Be("https://example.com/img1.jpg");
        page.LocalImageUrl.Should().Be("manga/1/1.webp");
        page.Size.Should().Be(12345);
        page.Width.Should().Be(800);
        page.Height.Should().Be(1200);

        // Update dimension
        page.UpdateDimension(1080, 1920);
        page.Width.Should().Be(1080);
        page.Height.Should().Be(1920);

        // Update local image with dimension
        page.UpdateLocalImage("manga/1/1_fixed.webp", 20000, 1200, 2000);
        page.LocalImageUrl.Should().Be("manga/1/1_fixed.webp");
        page.Size.Should().Be(20000);
        page.Width.Should().Be(1200);
        page.Height.Should().Be(2000);

        // Update local image without dimension preserves existing dimensions
        page.UpdateLocalImage("manga/1/1_v3.webp", 25000);
        page.LocalImageUrl.Should().Be("manga/1/1_v3.webp");
        page.Size.Should().Be(25000);
        page.Width.Should().Be(1200);
        page.Height.Should().Be(2000);
    }

    [Fact]
    public void UpdateThumbnail_ShouldUpdateAllThumbnailPropertiesAndUpdatedAt()
    {
        // Arrange
        var manga = Manga.Create("One Piece", "Eiichiro Oda", "Manga", "Komiku");
        var newImageUrl = "https://example.com/new-cover.jpg";
        var newLocalImageUrl = "One Piece/thumbnail.webp";
        var newSize = 54321L;

        // Act
        manga.UpdateThumbnail(newImageUrl, newLocalImageUrl, newSize);

        // Assert
        manga.ImageUrl.Should().Be(newImageUrl);
        manga.LocalImageUrl.Should().Be(newLocalImageUrl);
        manga.ThumbnailSize.Should().Be(newSize);
    }

    [Fact]
    public void UpdateTitleAndFileRoutes_ShouldUpdateTitle_PreserveOldTitleInSynonyms_AndMigrateAllFileRoutes()
    {
        // Arrange
        var manga = Manga.Create("Solo Leveling", "Chugong", "Manhwa", "Komiku");
        manga.UpdateThumbnail("https://example.com/sl.jpg", "Solo Leveling/thumbnail.webp", 12345);

        var chapter = new Chapter(
            ChapterId.New(),
            1.0,
            "https://example.com/ch1",
            "Komiku",
            null,
            "en",
            100,
            DateTime.UtcNow,
            new List<Page>
            {
                new(Guid.NewGuid(), "https://example.com/p1.jpg", "Solo Leveling/1/1.webp", 1000, 800, 1200),
                new(Guid.NewGuid(), "https://example.com/p2.jpg", "Solo Leveling/1/2.webp", 2000, 800, 1200)
            });
        manga.AddChapter(chapter);

        // Act
        manga.UpdateTitleAndFileRoutes("Only I Level Up", "Only I Level Up", "Solo Leveling");

        // Assert
        manga.Title.Should().Be("Only I Level Up");
        manga.Synonyms.Should().Contain("Solo Leveling");
        manga.LocalImageUrl.Should().Be("Only I Level Up/thumbnail.webp");
        manga.Chapters[0].Pages[0].LocalImageUrl.Should().Be("Only I Level Up/1/1.webp");
        manga.Chapters[0].Pages[1].LocalImageUrl.Should().Be("Only I Level Up/1/2.webp");
    }

    [Fact]
    public void UpdateTitleAndFileRoutes_WhenOldTitleAlreadyInSynonyms_ShouldNotDuplicateSynonym()
    {
        // Arrange
        var manga = Manga.Create("Naruto", "Kishimoto", "Manga", "Komiku", synonyms: new List<string> { "Naruto" });

        // Act
        manga.UpdateTitleAndFileRoutes("Naruto Shippuden", "Naruto Shippuden", "Naruto");

        // Assert
        manga.Title.Should().Be("Naruto Shippuden");
        manga.Synonyms.Count(s => s.Equals("Naruto", StringComparison.OrdinalIgnoreCase)).Should().Be(1);
    }

    [Fact]
    public void UpdateTitleOnly_ShouldUpdateTitle_AndPreserveOldTitleInSynonyms()
    {
        // Arrange
        var manga = Manga.Create("One Piece!", "Oda", "Manga", "Komiku");

        // Act
        manga.UpdateTitleOnly("One Piece?");

        // Assert
        manga.Title.Should().Be("One Piece?");
        manga.Synonyms.Should().Contain("One Piece!");
    }

    [Fact]
    public void IncrementChapterView_WhenChapterExists_ShouldIncrementBothChapterAndMangaView()
    {
        // Arrange
        var manga = Manga.Create("One Piece", "Oda", "Manga", "Komiku");
        var chapterId = ChapterId.New();
        var chapter = new Chapter(chapterId, 1.0, "link", "Komiku", "icon", "id", totalView: 5, DateTime.UtcNow);
        manga.AddChapter(chapter);

        var initialMangaViews = manga.TotalView;
        var initialUpdatedAt = manga.UpdatedAt;

        // Act
        var result = manga.IncrementChapterView(chapterId);

        // Assert
        result.Should().BeTrue();
        manga.Chapters.First(c => c.Id == chapterId).TotalView.Should().Be(6);
        manga.TotalView.Should().Be(initialMangaViews + 1);
        manga.UpdatedAt.Should().Be(initialUpdatedAt);
    }

    [Fact]
    public void IncrementChapterView_WhenChapterDoesNotExist_ShouldReturnFalseAndNotChangeViews()
    {
        // Arrange
        var manga = Manga.Create("One Piece", "Oda", "Manga", "Komiku");
        var nonExistentChapterId = ChapterId.New();
        var initialMangaViews = manga.TotalView;

        // Act
        var result = manga.IncrementChapterView(nonExistentChapterId);

        // Assert
        result.Should().BeFalse();
        manga.TotalView.Should().Be(initialMangaViews);
    }
}

