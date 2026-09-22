using FluentAssertions;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Messaging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Contracts.Responses;
using Xunit;

namespace UnitTests.MangaScrapper;

public class ScrapMangaHandlerTests
{
    [Fact]
    public async Task HandleAsync_WhenProviderRegistered_ShouldExtractManga()
    {
        // Arrange
        var mockScrapper = new Mock<IProviderScrapperService>();
        mockScrapper.Setup(s => s.ExtractManga(It.IsAny<string>(), It.IsAny<CancellationToken>(), It.IsAny<bool>(), It.IsAny<string?>()))
            .ReturnsAsync(new ScrapperMangaDocumentResponse { Title = "Test Manga" });

        var services = new ServiceCollection();
        services.AddKeyedScoped<IProviderScrapperService>("kiryuu", (sp, key) => mockScrapper.Object);
        var serviceProvider = services.BuildServiceProvider();

        var mockLogger = new Mock<ILogger<ScrapMangaHandler>>();
        var handler = new ScrapMangaHandler(serviceProvider, mockLogger.Object);

        var evt = new ScrapMangaIntegrationEvent("kiryuu", "https://kiryuu01.com/manga/test-manga", true, null);

        // Act
        await handler.HandleAsync(evt, CancellationToken.None);

        // Assert
        mockScrapper.Verify(s => s.ExtractManga("https://kiryuu01.com/manga/test-manga", It.IsAny<CancellationToken>(), true, null), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WhenProviderNotRegistered_ShouldLogWarningAndNotThrow()
    {
        // Arrange
        var services = new ServiceCollection();
        var serviceProvider = services.BuildServiceProvider();

        var mockLogger = new Mock<ILogger<ScrapMangaHandler>>();
        var handler = new ScrapMangaHandler(serviceProvider, mockLogger.Object);

        var evt = new ScrapMangaIntegrationEvent("unknown_provider", "https://example.com/manga/test", true, null);

        // Act
        var act = async () => await handler.HandleAsync(evt, CancellationToken.None);

        // Assert
        await act.Should().NotThrowAsync();
    }
}
