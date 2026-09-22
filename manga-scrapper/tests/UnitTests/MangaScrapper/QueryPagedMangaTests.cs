using FluentAssertions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Mappings;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Features.Mangas.QueryPagedManga;
using MangaScrapper.Core.Repositories;
using Mapster;
using Moq;
using NovaStack.Contracts.Requests;
using NovaStack.SharedKernel.Common;
using Xunit;

namespace UnitTests.MangaScrapper.Application;

public class QueryPagedMangaTests
{
    private readonly Mock<IMangaExternalRepository> _externalRepoMock;
    private readonly QueryPagedMangaQueryHandler _handler;
    private readonly QueryPagedMangaValidator _validator;

    public QueryPagedMangaTests()
    {
        TypeAdapterConfig.GlobalSettings.Scan(typeof(MangaMappingConfig).Assembly);
        _externalRepoMock = new Mock<IMangaExternalRepository>();
        _handler = new QueryPagedMangaQueryHandler(_externalRepoMock.Object);
        _validator = new QueryPagedMangaValidator();
    }

    [Fact]
    public async Task Handle_WithAdvancedFilterAndSort_ShouldReturnPagedResponse()
    {
        // Arrange
        var mangaList = new List<Manga>
        {
            Manga.Create("One Piece", "Eiichiro Oda", "Manga", source: "Komiku", rating: 9.2),
            Manga.Create("Naruto", "Masashi Kishimoto", "Manga", source: "Komiku", rating: 8.5)
        };

        var pagedList = new PagedList<Manga>(mangaList, page: 1, pageSize: 10, totalCount: 2);

        _externalRepoMock
            .Setup(r => r.QueryAdvancedAsync(
                It.IsAny<MangaAdvancedFilter?>(),
                It.IsAny<List<MangaSortOption>?>(),
                It.IsAny<int>(),
                It.IsAny<int>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(pagedList);

        var filter = new MangaAdvancedFilter
        {
            Search = "One",
            IncludedGenres = new List<string> { "Action", "Adventure" },
            GenreMatchMode = "And",
            ExcludedGenres = new List<string> { "Horror" },
            Statuses = new List<string> { "Ongoing" },
            Types = new List<string> { "Manga" },
            MinRating = 8.0,
            MaxRating = 10.0,
            Nsfw = false
        };

        var sorts = new List<MangaSortOption>
        {
            new() { Field = "rating", Direction = "desc" },
            new() { Field = "popularity", Direction = "asc" }
        };

        var query = new QueryPagedMangaQuery(filter, sorts, Page: 1, PageSize: 10);

        // Act
        var result = await _handler.Handle(query, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull();
        result.Value.Items.Should().HaveCount(2);
        result.Value.TotalCount.Should().Be(2);
        result.Value.Page.Should().Be(1);
        result.Value.PageSize.Should().Be(10);
    }

    [Theory]
    [InlineData(0, 10, false)]
    [InlineData(1, 0, false)]
    [InlineData(1, 101, false)]
    [InlineData(1, 50, true)]
    public void Validator_PaginationRules_ShouldValidateCorrectly(int page, int pageSize, bool isValid)
    {
        var query = new QueryPagedMangaQuery(Page: page, PageSize: pageSize);
        var result = _validator.Validate(query);

        result.IsValid.Should().Be(isValid);
    }

    [Fact]
    public void Validator_InvalidRatingRange_ShouldFailValidation()
    {
        var filter = new MangaAdvancedFilter
        {
            MinRating = 9.0,
            MaxRating = 5.0
        };

        var query = new QueryPagedMangaQuery(Filter: filter);
        var result = _validator.Validate(query);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.ErrorMessage.Contains("MinRating cannot be greater than MaxRating"));
    }

    [Fact]
    public void Validator_InvalidSortFieldOrDirection_ShouldFailValidation()
    {
        var sorts = new List<MangaSortOption>
        {
            new() { Field = "nonexistent_field", Direction = "invalid_dir" }
        };

        var query = new QueryPagedMangaQuery(Sorts: sorts);
        var result = _validator.Validate(query);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.ErrorMessage.Contains("invalid"));
    }

    [Fact]
    public void Validator_ValidComplexFilterAndSort_ShouldPassValidation()
    {
        var filter = new MangaAdvancedFilter
        {
            Search = "Hunter",
            IncludedGenres = new List<string> { "Action", "Adventure" },
            ExcludedGenres = new List<string> { "Ecchi" },
            Statuses = new List<string> { "Ongoing" },
            Types = new List<string> { "Manga" },
            Author = "Togashi Yoshihiro",
            MinRating = 7.5,
            MaxRating = 9.9,
            MinPopularity = 1,
            MaxPopularity = 500,
            MinTotalView = 1000,
            MinChapters = 10,
            StartReleaseDate = new DateTime(1990, 1, 1),
            EndReleaseDate = new DateTime(2025, 1, 1),
            Nsfw = false
        };

        var sorts = new List<MangaSortOption>
        {
            new() { Field = "rating", Direction = "desc" },
            new() { Field = "updatedAt", Direction = "desc" }
        };

        var query = new QueryPagedMangaQuery(Filter: filter, Sorts: sorts, Page: 1, PageSize: 20);
        var result = _validator.Validate(query);

        result.IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(12345, true)]
    [InlineData(-1, false)]
    public void Validator_AnilistId_ShouldValidateCorrectly(int anilistId, bool isValid)
    {
        var filter = new MangaAdvancedFilter
        {
            AnilistId = anilistId
        };

        var query = new QueryPagedMangaQuery(Filter: filter);
        var result = _validator.Validate(query);

        result.IsValid.Should().Be(isValid);
    }
}
