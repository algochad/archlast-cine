using FluentAssertions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Common.Mappings;
using MangaScrapper.Core.Features.Mangas.UpdateManga;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace UnitTests.MangaScrapper;

public class UpdateMangaTests : IDisposable
{
    private readonly string _tempStorageDir;

    public UpdateMangaTests()
    {
        TypeAdapterConfig.GlobalSettings.Scan(typeof(MangaMappingConfig).Assembly);
        _tempStorageDir = Path.Combine(Path.GetTempPath(), "manga_update_tests_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempStorageDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempStorageDir))
        {
            try { Directory.Delete(_tempStorageDir, true); } catch { /* ignore */ }
        }
    }

    [Fact]
    public async Task Handle_WhenMangaNotFound_ShouldReturnNotFound()
    {
        // Arrange
        var mangaRepo = new Mock<IMangaRepository>();
        var externalRepo = new Mock<IMangaExternalRepository>();
        var settings = new Mock<IScrapperSettingsProvider>();
        var userLibRepo = new Mock<IUserLibraryRepository>();
        var logger = new Mock<ILogger<UpdateMangaCommandHandler>>();

        mangaRepo.Setup(r => r.GetByIdAsync(It.IsAny<MangaId>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Manga?)null);

        var handler = new UpdateMangaCommandHandler(
            mangaRepo.Object, externalRepo.Object, settings.Object, userLibRepo.Object, logger.Object);

        var command = new UpdateMangaCommand(
            Guid.NewGuid(), 0, null, null, "Author", "Manga", null, new List<string>(), new List<string>(),
            null, null, null, false, null, 0, 0, 0, "New Title");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Manga.NotFound");
    }

    [Fact]
    public async Task Handle_WhenTitleChanged_ShouldMoveDirectory_UpdateFileRoutes_AndPersist()
    {
        // Arrange
        var manga = Manga.Create("Solo Leveling", "Chugong", "Manhwa", "Komiku");
        var mangaId = manga.Id.Value;
        manga.UpdateThumbnail("http://example.com/sl.jpg", "Solo Leveling/thumbnail.webp", 1234);

        var oldDir = Path.Combine(_tempStorageDir, "Solo Leveling");
        Directory.CreateDirectory(oldDir);
        var testFilePath = Path.Combine(oldDir, "thumbnail.webp");
        await File.WriteAllTextAsync(testFilePath, "mock-image-data");

        var mangaRepo = new Mock<IMangaRepository>();
        mangaRepo.Setup(r => r.GetByIdAsync(manga.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(manga);

        var externalRepo = new Mock<IMangaExternalRepository>();
        var settings = new Mock<IScrapperSettingsProvider>();
        settings.SetupGet(s => s.ImageStoragePath).Returns(_tempStorageDir);

        var userLibRepo = new Mock<IUserLibraryRepository>();
        var logger = new Mock<ILogger<UpdateMangaCommandHandler>>();

        var handler = new UpdateMangaCommandHandler(
            mangaRepo.Object, externalRepo.Object, settings.Object, userLibRepo.Object, logger.Object);

        var command = new UpdateMangaCommand(
            mangaId, 123, 456, 789, "Chugong", "Manhwa", new List<string> { "ExistingSynonym" },
            new List<string> { "Action" }, new List<string>(), "Desc", 9.5, null, false, "Ongoing", 100, 10, 50,
            "Only I Level Up");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();

        // Check aggregate changes
        manga.Title.Should().Be("Only I Level Up");
        manga.Synonyms.Should().Contain("Solo Leveling");
        manga.LocalImageUrl.Should().Be("Only I Level Up/thumbnail.webp");

        // Check directory moved on disk
        Directory.Exists(oldDir).Should().BeFalse();
        var newDir = Path.Combine(_tempStorageDir, "Only I Level Up");
        Directory.Exists(newDir).Should().BeTrue();
        File.Exists(Path.Combine(newDir, "thumbnail.webp")).Should().BeTrue();

        // Check user library repository call
        userLibRepo.Verify(r => r.UpdateMangaInfoAsync(
            mangaId, "Only I Level Up", "Only I Level Up/thumbnail.webp", It.IsAny<CancellationToken>()), Times.Once);

        // Check repositories updated
        mangaRepo.Verify(r => r.UpdateAsync(manga, It.IsAny<CancellationToken>()), Times.Once);
        externalRepo.Verify(r => r.IndexMangaAsync(manga, It.IsAny<CancellationToken>()), Times.Once);
        externalRepo.Verify(r => r.UpsertMangaAsync(manga, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_WhenTargetDirectoryAlreadyExists_ShouldReturnConflict()
    {
        var manga = Manga.Create("Original Title", "Author", "Manga", "Komiku");
        var mangaId = manga.Id.Value;

        var oldDir = Path.Combine(_tempStorageDir, "Original Title");
        var newDir = Path.Combine(_tempStorageDir, "Conflicting Title");
        Directory.CreateDirectory(oldDir);
        Directory.CreateDirectory(newDir);

        var mangaRepo = new Mock<IMangaRepository>();
        mangaRepo.Setup(r => r.GetByIdAsync(manga.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(manga);

        var externalRepo = new Mock<IMangaExternalRepository>();
        var settings = new Mock<IScrapperSettingsProvider>();
        settings.SetupGet(s => s.ImageStoragePath).Returns(_tempStorageDir);

        var userLibRepo = new Mock<IUserLibraryRepository>();
        var logger = new Mock<ILogger<UpdateMangaCommandHandler>>();

        var handler = new UpdateMangaCommandHandler(
            mangaRepo.Object, externalRepo.Object, settings.Object, userLibRepo.Object, logger.Object);

        var command = new UpdateMangaCommand(
            mangaId, 0, null, null, "Author", "Manga", null, new List<string>(), new List<string>(),
            null, null, null, false, null, 0, 0, 0, "Conflicting Title");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Manga.DirectoryConflict");
        mangaRepo.Verify(r => r.UpdateAsync(It.IsAny<Manga>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_WhenCommandSynonymsIsNull_ShouldUpdateTitleSuccessfully()
    {
        var manga = Manga.Create("Old Manga Title", "Author", "Manga", "Komiku");
        var mangaId = manga.Id.Value;

        var mangaRepo = new Mock<IMangaRepository>();
        mangaRepo.Setup(r => r.GetByIdAsync(manga.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(manga);

        var externalRepo = new Mock<IMangaExternalRepository>();
        var settings = new Mock<IScrapperSettingsProvider>();
        settings.SetupGet(s => s.ImageStoragePath).Returns(_tempStorageDir);

        var userLibRepo = new Mock<IUserLibraryRepository>();
        var logger = new Mock<ILogger<UpdateMangaCommandHandler>>();

        var handler = new UpdateMangaCommandHandler(
            mangaRepo.Object, externalRepo.Object, settings.Object, userLibRepo.Object, logger.Object);

        var command = new UpdateMangaCommand(
            mangaId, 0, null, null, "Author", "Manga", null, new List<string>(), new List<string>(),
            null, null, null, false, null, 0, 0, 0, "New Manga Title");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        manga.Title.Should().Be("New Manga Title");
        manga.Synonyms.Should().Contain("Old Manga Title");
    }
}

