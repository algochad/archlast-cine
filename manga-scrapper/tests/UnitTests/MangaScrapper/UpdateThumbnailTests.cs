using FluentAssertions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Common.Mappings;
using MangaScrapper.Core.Features.Mangas.UpdateThumbnail;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using Microsoft.Extensions.Logging;
using Moq;
using SkiaSharp;
using Xunit;

namespace UnitTests.MangaScrapper;

public class UpdateThumbnailTests : IDisposable
{
    private readonly string _tempDir;

    public UpdateThumbnailTests()
    {
        TypeAdapterConfig.GlobalSettings.Scan(typeof(MangaMappingConfig).Assembly);
        _tempDir = Path.Combine(Path.GetTempPath(), "manga_thumb_tests_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            try { Directory.Delete(_tempDir, true); } catch { /* ignore */ }
        }
    }

    [Fact]
    public async Task UploadThumbnail_WhenMangaNotFound_ShouldReturnNotFound()
    {
        // Arrange
        var mangaRepo = new Mock<IMangaRepository>();
        var mangaExternalRepo = new Mock<IMangaExternalRepository>();
        var settingsProvider = new Mock<IScrapperSettingsProvider>();
        var logger = new Mock<ILogger<UploadThumbnailCommandHandler>>();

        mangaRepo.Setup(r => r.GetByIdAsync(It.IsAny<MangaId>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Manga?)null);

        var handler = new UploadThumbnailCommandHandler(mangaRepo.Object, mangaExternalRepo.Object, settingsProvider.Object, logger.Object);

        var command = new UploadThumbnailCommand(Guid.NewGuid(), new byte[] { 1, 2, 3 }, "image/png", "cover.png");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Manga.NotFound");
    }

    [Fact]
    public async Task UploadThumbnail_WhenEmptyBytes_ShouldReturnValidationError()
    {
        // Arrange
        var manga = Manga.Create("Test Manga", "Author", "Manga", "Komiku");
        var mangaRepo = new Mock<IMangaRepository>();
        var mangaExternalRepo = new Mock<IMangaExternalRepository>();
        var settingsProvider = new Mock<IScrapperSettingsProvider>();
        var logger = new Mock<ILogger<UploadThumbnailCommandHandler>>();

        mangaRepo.Setup(r => r.GetByIdAsync(It.IsAny<MangaId>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(manga);

        var handler = new UploadThumbnailCommandHandler(mangaRepo.Object, mangaExternalRepo.Object, settingsProvider.Object, logger.Object);

        var command = new UploadThumbnailCommand(manga.Id.Value, Array.Empty<byte>(), "image/png", "cover.png");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Thumbnail.EmptyFile");
    }

    [Fact]
    public async Task UploadThumbnail_WithValidImage_ShouldSaveThumbnailAndUpdateManga()
    {
        // Arrange
        var manga = Manga.Create("Naruto Test", "Author", "Manga", "Komiku");
        var mangaRepo = new Mock<IMangaRepository>();
        var mangaExternalRepo = new Mock<IMangaExternalRepository>();
        var settingsProvider = new Mock<IScrapperSettingsProvider>();
        var logger = new Mock<ILogger<UploadThumbnailCommandHandler>>();

        settingsProvider.Setup(s => s.ImageStoragePath).Returns(_tempDir);
        mangaRepo.Setup(r => r.GetByIdAsync(It.IsAny<MangaId>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(manga);

        // Create a small bitmap image in memory
        using var bitmap = new SKBitmap(100, 150);
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        var imageBytes = data.ToArray();

        var handler = new UploadThumbnailCommandHandler(mangaRepo.Object, mangaExternalRepo.Object, settingsProvider.Object, logger.Object);
        var command = new UploadThumbnailCommand(manga.Id.Value, imageBytes, "image/png", "cover.png");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        manga.LocalImageUrl.Should().NotBeNullOrEmpty();
        manga.LocalImageUrl.Should().Contain("Naruto Test/thumbnail.webp");
        manga.ThumbnailSize.Should().BeGreaterThan(0);

        mangaRepo.Verify(r => r.UpdateAsync(manga, It.IsAny<CancellationToken>()), Times.Once);
        mangaExternalRepo.Verify(r => r.IndexMangaAsync(manga, It.IsAny<CancellationToken>()), Times.Once);
        mangaExternalRepo.Verify(r => r.UpsertMangaAsync(manga, It.IsAny<CancellationToken>()), Times.Once);

        var savedFile = Path.Combine(_tempDir, "Naruto Test", "thumbnail.webp");
        File.Exists(savedFile).Should().BeTrue();
    }

    [Fact]
    public async Task UpdateThumbnail_WhenMangaNotFound_ShouldReturnNotFound()
    {
        // Arrange
        var mangaRepo = new Mock<IMangaRepository>();
        var mangaExternalRepo = new Mock<IMangaExternalRepository>();
        var settingsProvider = new Mock<IScrapperSettingsProvider>();
        var httpClientFactory = new Mock<IHttpClientFactory>();
        var logger = new Mock<ILogger<UpdateThumbnailCommandHandler>>();

        mangaRepo.Setup(r => r.GetByIdAsync(It.IsAny<MangaId>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Manga?)null);

        var handler = new UpdateThumbnailCommandHandler(
            mangaRepo.Object,
            mangaExternalRepo.Object,
            settingsProvider.Object,
            httpClientFactory.Object,
            null!,
            logger.Object);

        var command = new UpdateThumbnailCommand(Guid.NewGuid(), "https://example.com/cover.jpg");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Manga.NotFound");
    }

    [Fact]
    public async Task UpdateThumbnail_WhenInvalidUrl_ShouldReturnValidationError()
    {
        // Arrange
        var manga = Manga.Create("Test Manga", "Author", "Manga", "Komiku");
        var mangaRepo = new Mock<IMangaRepository>();
        var mangaExternalRepo = new Mock<IMangaExternalRepository>();
        var settingsProvider = new Mock<IScrapperSettingsProvider>();
        var httpClientFactory = new Mock<IHttpClientFactory>();
        var logger = new Mock<ILogger<UpdateThumbnailCommandHandler>>();

        mangaRepo.Setup(r => r.GetByIdAsync(It.IsAny<MangaId>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(manga);

        var handler = new UpdateThumbnailCommandHandler(
            mangaRepo.Object,
            mangaExternalRepo.Object,
            settingsProvider.Object,
            httpClientFactory.Object,
            null!,
            logger.Object);

        var command = new UpdateThumbnailCommand(manga.Id.Value, "not-a-valid-url");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Thumbnail.InvalidUrl");
    }
}
