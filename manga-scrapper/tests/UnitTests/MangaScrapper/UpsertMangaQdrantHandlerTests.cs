using FluentAssertions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Messaging;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.ValueObjects;
using Microsoft.Extensions.Logging;
using Moq;
using NovaStack.Contracts.IntegrationEvents;
using Xunit;

namespace UnitTests.MangaScrapper;

public class UpsertMangaQdrantHandlerTests
{
    [Fact]
    public async Task HandleAsync_WhenMangaNotFound_ShouldSkipUpsert()
    {
        // Arrange
        var mockRepo = new Mock<IMangaRepository>();
        var mockLogger = new Mock<ILogger<UpsertMangaQdrantHandler>>();
        var mangaId = Guid.NewGuid();

        mockRepo.Setup(r => r.GetByIdAsync(It.IsAny<MangaId>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Manga?)null);

        // We can create handler with null QdrantService if manga is not found because it exits early
        var handler = new UpsertMangaQdrantHandler(mockRepo.Object, null!, mockLogger.Object);
        var evt = new UpsertMangaQdrantIntegrationEvent(mangaId);

        // Act
        await handler.HandleAsync(evt, CancellationToken.None);

        // Assert
        mockRepo.Verify(r => r.GetByIdAsync(MangaId.From(mangaId), It.IsAny<CancellationToken>()), Times.Once);
    }
}
