using FluentAssertions;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Hubs;
using MangaScrapper.Core.Messaging;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Moq;
using NovaStack.Contracts.IntegrationEvents;
using Xunit;

namespace UnitTests.MangaScrapper;

public class ChapterScrapingProgressSignalRHandlerTests
{
    [Fact]
    public async Task HandleAsync_ShouldBroadcastChapterScrapingProgressToGroupAndAllClients()
    {
        // Arrange
        var mockHubContext = new Mock<IHubContext<MangaHub>>();
        var mockClients = new Mock<IHubClients>();
        var mockClientProxy = new Mock<IClientProxy>();
        var mockLogger = new Mock<ILogger<ChapterScrapingProgressSignalRHandler>>();

        mockHubContext.Setup(h => h.Clients).Returns(mockClients.Object);
        mockClients.Setup(c => c.Group(It.IsAny<string>())).Returns(mockClientProxy.Object);
        mockClients.Setup(c => c.All).Returns(mockClientProxy.Object);

        var handler = new ChapterScrapingProgressSignalRHandler(mockHubContext.Object, mockLogger.Object);

        var mangaId = Guid.NewGuid();
        var chapterId = Guid.NewGuid();
        var evt = new ChapterScrapingProgressIntegrationEvent(
            mangaId,
            "One Piece",
            chapterId,
            1100.0,
            downloadedPages: 9,
            totalPages: 18,
            percent: 50,
            status: "InProgress");

        // Act
        await handler.HandleAsync(evt, CancellationToken.None);

        // Assert
        var expectedGroup = MangaHub.GetMangaGroupName(mangaId);
        mockClients.Verify(c => c.Group(expectedGroup), Times.Once);
        mockClients.Verify(c => c.All, Times.Once);
        mockClientProxy.Verify(
            p => p.SendCoreAsync("ChapterScrapingProgress", It.IsAny<object[]>(), It.IsAny<CancellationToken>()),
            Times.Exactly(2));
    }

    [Fact]
    public async Task HandleAsync_ShouldInvokeProcessTrackerWhenProvided()
    {
        // Arrange
        var mockHubContext = new Mock<IHubContext<MangaHub>>();
        var mockClients = new Mock<IHubClients>();
        var mockClientProxy = new Mock<IClientProxy>();
        var mockLogger = new Mock<ILogger<ChapterScrapingProgressSignalRHandler>>();
        var mockTracker = new Mock<IScrapingProcessTracker>();

        mockHubContext.Setup(h => h.Clients).Returns(mockClients.Object);
        mockClients.Setup(c => c.Group(It.IsAny<string>())).Returns(mockClientProxy.Object);
        mockClients.Setup(c => c.All).Returns(mockClientProxy.Object);

        var handler = new ChapterScrapingProgressSignalRHandler(
            mockHubContext.Object, 
            mockLogger.Object, 
            mockTracker.Object);

        var evt = new ChapterScrapingProgressIntegrationEvent(
            Guid.NewGuid(), "Bleach", Guid.NewGuid(), 1.0, 10, 20, 50, "InProgress");

        // Act
        await handler.HandleAsync(evt, CancellationToken.None);

        // Assert
        mockTracker.Verify(t => t.TrackProgress(evt), Times.Once);
    }
}

