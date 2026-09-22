using FluentAssertions;
using FluentValidation.TestHelper;
using MangaScrapper.Core.Features.Mangas.IncrementChapterView;
using MangaScrapper.Core.Repositories;
using Moq;
using Xunit;

namespace UnitTests.MangaScrapper;

public class IncrementChapterViewTests
{
    private readonly Mock<IMangaRepository> _mangaRepositoryMock = new();
    private readonly IncrementChapterViewCommandHandler _handler;
    private readonly IncrementChapterViewCommandValidator _validator;

    public IncrementChapterViewTests()
    {
        _handler = new IncrementChapterViewCommandHandler(_mangaRepositoryMock.Object);
        _validator = new IncrementChapterViewCommandValidator();
    }

    [Fact]
    public async Task Handle_WhenChapterExists_ShouldReturnSuccess()
    {
        // Arrange
        var chapterId = Guid.NewGuid();
        var mangaId = Guid.NewGuid();
        var command = new IncrementChapterViewCommand(chapterId, mangaId);

        _mangaRepositoryMock.Setup(x => x.IncrementChapterViewAsync(chapterId, mangaId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        // Act
        var result = await _handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        _mangaRepositoryMock.Verify(x => x.IncrementChapterViewAsync(chapterId, mangaId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_WhenChapterNotFound_ShouldReturnNotFoundError()
    {
        // Arrange
        var chapterId = Guid.NewGuid();
        var command = new IncrementChapterViewCommand(chapterId);

        _mangaRepositoryMock.Setup(x => x.IncrementChapterViewAsync(chapterId, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        // Act
        var result = await _handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Chapter.NotFound");
    }

    [Fact]
    public void Validator_WhenChapterIdIsEmpty_ShouldHaveValidationError()
    {
        // Arrange
        var command = new IncrementChapterViewCommand(Guid.Empty);

        // Act
        var result = _validator.TestValidate(command);

        // Assert
        result.ShouldHaveValidationErrorFor(x => x.ChapterId);
    }
}
