using FluentAssertions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Mappings;
using MangaScrapper.Core.Persistence.Documents;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using Xunit;

namespace UnitTests.MangaScrapper;

public class MangaMappingTests
{
    public MangaMappingTests()
    {
        TypeAdapterConfig.GlobalSettings.Scan(typeof(MangaMappingConfig).Assembly);
    }

    [Fact]
    public void MangaDocument_To_Manga_ShouldPreserveGuidId()
    {
        // Arrange
        var expectedId = Guid.CreateVersion7();
        var doc = new MangaDocument
        {
            Id = expectedId,
            Title = "Test Manga",
            Author = "Test Author",
            Type = "Manga",
            MalId = 123,
            Status = "Ongoing",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Chapters = new List<ChapterDocument>
            {
                new ChapterDocument
                {
                    Id = Guid.CreateVersion7(),
                    Number = 1.0,
                    Language = "en",
                    UploadDate = DateTime.UtcNow
                }
            }
        };

        // Act
        var manga = doc.Adapt<Manga>();

        // Assert
        manga.Should().NotBeNull();
        manga.Id.Value.Should().Be(expectedId);
        manga.Id.Value.Should().NotBe(Guid.Empty);
    }

    [Fact]
    public void Chapter_To_ChapterResponse_ShouldExcludePages_AndPopulatePageCounts()
    {
        // Arrange
        var chapterId = ChapterId.New();
        var chapter = new Chapter(
            chapterId,
            1.0,
            "https://example.com",
            "Provider",
            "Icon",
            "en",
            100,
            DateTime.UtcNow,
            new List<Page>
            {
                new Page(Guid.NewGuid(), "https://img1.com", "local1.webp", 1000, 800, 1200, false),
                new Page(Guid.NewGuid(), "https://img2.com", "local2.webp", 1000, 800, 1200, true)
            }
        );

        // Act
        var response = chapter.Adapt<NovaStack.Contracts.Responses.ChapterResponse>();

        // Assert
        response.Should().NotBeNull();
        response.Id.Should().Be(chapterId.Value);
        response.Number.Should().Be(1.0);
        response.TotalPages.Should().Be(2);
        response.BrokenPageCount.Should().Be(1);
        response.Pages.Should().BeNull(); // Pages excluded for efficiency in chapter lists
    }
}
