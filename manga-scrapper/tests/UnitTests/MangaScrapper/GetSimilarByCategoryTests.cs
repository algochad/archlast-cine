using FluentAssertions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Mappings;
using MangaScrapper.Core.Features.Mangas.GetSimilarByCategory;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using Moq;
using Xunit;

namespace UnitTests.MangaScrapper;

public class GetSimilarByCategoryTests
{
    private readonly Mock<IMangaExternalRepository> _externalRepositoryMock;
    private readonly Mock<IMangaRepository> _mangaRepositoryMock;
    private readonly GetSimilarByCategoryQueryHandler _handler;

    public GetSimilarByCategoryTests()
    {
        TypeAdapterConfig.GlobalSettings.Scan(typeof(MangaMappingConfig).Assembly);
        _externalRepositoryMock = new Mock<IMangaExternalRepository>();
        _mangaRepositoryMock = new Mock<IMangaRepository>();
        _handler = new GetSimilarByCategoryQueryHandler(_externalRepositoryMock.Object, _mangaRepositoryMock.Object);
    }

    [Fact]
    public void ParseAndCleanCategories_WithUserContoh1_ShouldCleanAndDeduplicateProperly()
    {
        // Arrange: Contoh 1 from user
        var rawInput = "Reincarnated as a Monster/Nonhuman, Slime, Magic, Reincarnation, Human Becomes Nonhuman, Monster POV, Dragon/s, Fantasy World, Fantasy Creature/s, Dwarf/ves, Goblin/s, Monster/s, Game Elements,";

        // Act
        var result = QdrantService.ParseAndCleanCategories(new[] { rawInput });

        // Assert
        result.Should().NotBeNull();
        result.Should().Contain("Reincarnated as a Monster Nonhuman");
        result.Should().Contain("Slime");
        result.Should().Contain("Magic");
        result.Should().Contain("Reincarnation");
        result.Should().Contain("Human Becomes Nonhuman");
        result.Should().Contain("Monster POV");
        result.Should().Contain("Dragons");
        result.Should().Contain("Fantasy World");
        result.Should().Contain("Fantasy Creatures");
        result.Should().Contain("Dwarf ves");
        result.Should().Contain("Goblins");
        result.Should().Contain("Monsters");
        result.Should().Contain("Game Elements");
        result.Should().NotContain(""); // Empty trailing entry must be filtered
    }

    [Fact]
    public void ParseAndCleanCategories_WithUserContoh2_ShouldCleanAndDeduplicateProperly()
    {
        // Arrange: Contoh 2 from user
        var rawInput = "All-Girls School, Genius/es, Physics, Glasses-Wearing Protagonist, Math, Smart Protagonist, High School, Teacher/s, Professor/s, Smart Male Lead, Unexpressed Feeling/s, Hidden Potential, Teenagers,Dedicated Protagonist, Unexpected Feeling/s, Modeling, Determined Protagonist, Model/s, Part-Time Job, Tsundere Character/s, Popular Male Lead, Tragic Past, Ambitious Goal/s, ";

        // Act
        var result = QdrantService.ParseAndCleanCategories(new[] { rawInput });

        // Assert
        result.Should().NotBeNull();
        result.Should().Contain("All-Girls School");
        result.Should().Contain("Geniuses");
        result.Should().Contain("Physics");
        result.Should().Contain("Glasses-Wearing Protagonist");
        result.Should().Contain("Math");
        result.Should().Contain("Smart Protagonist");
        result.Should().Contain("High School");
        result.Should().Contain("Teachers");
        result.Should().Contain("Professors");
        result.Should().Contain("Smart Male Lead");
        result.Should().Contain("Unexpressed Feelings");
        result.Should().Contain("Hidden Potential");
        result.Should().Contain("Teenagers");
        result.Should().Contain("Dedicated Protagonist");
        result.Should().Contain("Unexpected Feelings");
        result.Should().Contain("Modeling");
        result.Should().Contain("Determined Protagonist");
        result.Should().Contain("Models");
        result.Should().Contain("Part-Time Job");
        result.Should().Contain("Tsundere Characters");
        result.Should().Contain("Popular Male Lead");
        result.Should().Contain("Tragic Past");
        result.Should().Contain("Ambitious Goals");
    }

    [Fact]
    public async Task Handle_WhenCategoriesProvided_ShouldReturnSimilarMangaList()
    {
        // Arrange
        var mangaList = new List<Manga>
        {
            Manga.Create("That Time I Got Reincarnated as a Slime", "Fuse", "Manga", source: "Komiku"),
            Manga.Create("So I'm a Spider, So What?", "Okina Baba", "Manga", source: "Komiku")
        };

        _externalRepositoryMock
            .Setup(r => r.GetSimilarByCategoryAsync(
                It.IsAny<List<string>>(),
                It.IsAny<string?>(),
                It.IsAny<string?>(),
                It.IsAny<List<string>?>(),
                It.IsAny<Guid?>(),
                It.IsAny<int>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mangaList);

        var query = new GetSimilarByCategoryQuery(
            Categories: new List<string> { "Reincarnated as a Monster/Nonhuman", "Slime", "Magic" },
            Limit: 10);

        // Act
        var result = await _handler.Handle(query, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull();
        result.Value.Should().HaveCount(2);
        result.Value[0].Title.Should().Be("That Time I Got Reincarnated as a Slime");
    }

    [Fact]
    public async Task Handle_WhenNoCategoriesProvidedAndNoMangaId_ShouldReturnValidationError()
    {
        // Arrange
        var query = new GetSimilarByCategoryQuery(Categories: new List<string>());

        // Act
        var result = await _handler.Handle(query, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("Category.Required");
    }

    [Fact]
    public async Task Handle_WhenMangaIdProvided_ShouldResolveCategoriesFromManga()
    {
        // Arrange
        var sourceMangaId = Guid.NewGuid();
        var sourceManga = Manga.Create("Slime Tensei", "Fuse", "Manga", source: "Komiku", categories: new List<string> { "Slime", "Magic", "Reincarnation" });

        _mangaRepositoryMock
            .Setup(r => r.GetByIdAsync(MangaId.From(sourceMangaId), It.IsAny<CancellationToken>(), false))
            .ReturnsAsync(sourceManga);

        var similarManga = new List<Manga>
        {
            Manga.Create("Overlord", "Kugane Maruyama", "Manga", source: "Komiku")
        };

        _externalRepositoryMock
            .Setup(r => r.GetSimilarByCategoryAsync(
                It.Is<List<string>>(c => c.Contains("Slime") && c.Contains("Magic")),
                It.IsAny<string?>(),
                It.IsAny<string?>(),
                It.IsAny<List<string>?>(),
                sourceMangaId,
                10,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(similarManga);

        var query = new GetSimilarByCategoryQuery(MangaId: sourceMangaId, Limit: 10);

        // Act
        var result = await _handler.Handle(query, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull();
        result.Value.Should().HaveCount(1);
        result.Value[0].Title.Should().Be("Overlord");
    }
}
