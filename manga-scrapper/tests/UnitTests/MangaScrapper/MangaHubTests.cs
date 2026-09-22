using FluentAssertions;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Moq;
using NovaStack.Contracts.IntegrationEvents;
using Xunit;

namespace UnitTests.MangaScrapper;

public class MangaHubTests
{
    [Fact]
    public async Task ReportScrapingProgress_ShouldUpdateTrackerAndBroadcastToClients()
    {
        // Arrange
        var mockLogger = new Mock<ILogger<MangaHub>>();
        var mockTracker = new Mock<IScrapingProcessTracker>();
        var mockClients = new Mock<IHubCallerClients>();
        var mockClientProxy = new Mock<IClientProxy>();
        var mockGroupProxy = new Mock<IClientProxy>();

        mockClients.Setup(c => c.All).Returns(mockClientProxy.Object);
        mockClients.Setup(c => c.Group(It.IsAny<string>())).Returns(mockGroupProxy.Object);

        var hub = new MangaHub(mockLogger.Object, mockTracker.Object)
        {
            Clients = mockClients.Object
        };

        var mangaId = Guid.NewGuid();
        var chapterId = Guid.NewGuid();
        var payload = new ChapterScrapingProgressPayload
        {
            MangaId = mangaId,
            MangaTitle = "One Piece",
            ChapterId = chapterId,
            ChapterNumber = 1050,
            DownloadedPages = 10,
            TotalPages = 20,
            Percent = 50,
            Status = "InProgress",
            OccurredOn = DateTime.UtcNow
        };

        // Act
        await hub.ReportScrapingProgress(payload);

        // Assert
        mockTracker.Verify(t => t.TrackProgress(It.Is<ChapterScrapingProgressIntegrationEvent>(e =>
            e.MangaId == mangaId &&
            e.ChapterId == chapterId &&
            e.DownloadedPages == 10 &&
            e.Percent == 50)), Times.Once);

        var expectedGroup = MangaHub.GetMangaGroupName(mangaId);
        mockClients.Verify(c => c.Group(expectedGroup), Times.Once);
        mockClients.Verify(c => c.All, Times.Once);
        mockGroupProxy.Verify(p => p.SendCoreAsync("ChapterScrapingProgress", It.Is<object[]>(args => args.Length == 1 && args[0] == payload), It.IsAny<CancellationToken>()), Times.Once);
        mockClientProxy.Verify(p => p.SendCoreAsync("ChapterScrapingProgress", It.Is<object[]>(args => args.Length == 1 && args[0] == payload), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ReportChapterPagesScraped_ShouldBroadcastToGroupAndAllClients()
    {
        // Arrange
        var mockLogger = new Mock<ILogger<MangaHub>>();
        var mockClients = new Mock<IHubCallerClients>();
        var mockClientProxy = new Mock<IClientProxy>();
        var mockGroupProxy = new Mock<IClientProxy>();

        mockClients.Setup(c => c.All).Returns(mockClientProxy.Object);
        mockClients.Setup(c => c.Group(It.IsAny<string>())).Returns(mockGroupProxy.Object);

        var hub = new MangaHub(mockLogger.Object)
        {
            Clients = mockClients.Object
        };

        var mangaId = Guid.NewGuid();
        var chapterId = Guid.NewGuid();
        var payload = new ChapterPagesScrapedPayload
        {
            MangaId = mangaId,
            MangaTitle = "One Piece",
            ChapterId = chapterId,
            ChapterNumber = 1050,
            PageCount = 20,
            OccurredOn = DateTime.UtcNow
        };

        // Act
        await hub.ReportChapterPagesScraped(payload);

        // Assert
        var expectedGroup = MangaHub.GetMangaGroupName(mangaId);
        mockClients.Verify(c => c.Group(expectedGroup), Times.Once);
        mockClients.Verify(c => c.All, Times.Once);
        mockGroupProxy.Verify(p => p.SendCoreAsync("ChaptersUpdated", It.Is<object[]>(args => args.Length == 1 && args[0] == payload), It.IsAny<CancellationToken>()), Times.Once);
        mockClientProxy.Verify(p => p.SendCoreAsync("ChaptersUpdated", It.Is<object[]>(args => args.Length == 1 && args[0] == payload), It.IsAny<CancellationToken>()), Times.Once);
    }
}
