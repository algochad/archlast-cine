using FluentAssertions;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Hubs;
using MangaScrapper.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace UnitTests.MangaScrapper;

public class WorkerSignalRBroadcasterTests
{
    [Fact]
    public async Task BroadcastProgressAsync_WhenApiNotReachable_ShouldNotThrowException()
    {
        // Arrange
        var settings = Options.Create(new ScrapperSettings
        {
            // Pointing to a dummy/unreachable port to ensure resilience
            ApiBaseUrl = "http://127.0.0.1:59999"
        });
        var mockLogger = new Mock<ILogger<WorkerSignalRBroadcaster>>();

        var broadcaster = new WorkerSignalRBroadcaster(settings, mockLogger.Object);

        var payload = new ChapterScrapingProgressPayload
        {
            MangaId = Guid.NewGuid(),
            MangaTitle = "Test Manga",
            ChapterId = Guid.NewGuid(),
            ChapterNumber = 1,
            DownloadedPages = 1,
            TotalPages = 10,
            Percent = 10,
            Status = "InProgress"
        };

        // Act & Assert (should not throw)
        var act = () => broadcaster.BroadcastProgressAsync(payload, CancellationToken.None);
        await act.Should().NotThrowAsync();

        await broadcaster.DisposeAsync();
    }

    [Fact]
    public async Task BroadcastPagesScrapedAsync_WhenApiNotReachable_ShouldNotThrowException()
    {
        // Arrange
        var settings = Options.Create(new ScrapperSettings
        {
            ApiBaseUrl = "http://127.0.0.1:59999"
        });
        var mockLogger = new Mock<ILogger<WorkerSignalRBroadcaster>>();

        var broadcaster = new WorkerSignalRBroadcaster(settings, mockLogger.Object);

        var payload = new ChapterPagesScrapedPayload
        {
            MangaId = Guid.NewGuid(),
            MangaTitle = "Test Manga",
            ChapterId = Guid.NewGuid(),
            ChapterNumber = 1,
            PageCount = 10
        };

        // Act & Assert (should not throw)
        var act = () => broadcaster.BroadcastPagesScrapedAsync(payload, CancellationToken.None);
        await act.Should().NotThrowAsync();

        await broadcaster.DisposeAsync();
    }
}
