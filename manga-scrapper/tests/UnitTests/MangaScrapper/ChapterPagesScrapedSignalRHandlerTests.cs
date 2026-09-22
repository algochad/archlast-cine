using FluentAssertions;
using MangaScrapper.Core.Hubs;
using MangaScrapper.Core.Messaging;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Moq;
using NovaStack.Contracts.IntegrationEvents;
using Xunit;

namespace UnitTests.MangaScrapper;

public class ChapterPagesScrapedSignalRHandlerTests
{
    [Fact]
    public async Task HandleAsync_ShouldBroadcastChaptersUpdatedToGroupAndAllClients()
    {
        // Arrange
        var mockHubContext = new Mock<IHubContext<MangaHub>>();
        var mockClients = new Mock<IHubClients>();
        var mockClientProxy = new Mock<IClientProxy>();
        var mockLogger = new Mock<ILogger<ChapterPagesScrapedSignalRHandler>>();

        mockHubContext.Setup(h => h.Clients).Returns(mockClients.Object);
        mockClients.Setup(c => c.Group(It.IsAny<string>())).Returns(mockClientProxy.Object);
        mockClients.Setup(c => c.All).Returns(mockClientProxy.Object);

        var handler = new ChapterPagesScrapedSignalRHandler(mockHubContext.Object, mockLogger.Object);

        var mangaId = Guid.NewGuid();
        var chapterId = Guid.NewGuid();
        var evt = new ChapterPagesScrapedIntegrationEvent(
            mangaId,
            "One Piece",
            chapterId,
            1100.0,
            18);

        // Act
        await handler.HandleAsync(evt, CancellationToken.None);

        // Assert
        var expectedGroup = MangaHub.GetMangaGroupName(mangaId);
        mockClients.Verify(c => c.Group(expectedGroup), Times.Once);
        mockClients.Verify(c => c.All, Times.Once);
        mockClientProxy.Verify(
            p => p.SendCoreAsync("ChaptersUpdated", It.IsAny<object[]>(), It.IsAny<CancellationToken>()),
            Times.Exactly(2));
    }
}
