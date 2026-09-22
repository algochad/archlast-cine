using FluentAssertions;
using MangaScrapper.Core.Services;
using Microsoft.Extensions.Logging;
using Moq;
using NovaStack.Contracts.IntegrationEvents;
using Xunit;

namespace UnitTests.MangaScrapper;

public class ScrapingProcessManagerTests
{
    [Fact]
    public void ScrapingProcessTracker_ShouldTrackProgressAndMarkCancelledCorrectly()
    {
        // Arrange
        var tracker = new ScrapingProcessTracker();
        var mangaId = Guid.NewGuid();
        var ch1 = Guid.NewGuid();
        var ch2 = Guid.NewGuid();

        // Act - Track Queued
        tracker.TrackQueued(mangaId, "Naruto", ch1, 1.0);
        tracker.TrackQueued(mangaId, "Naruto", ch2, 2.0);

        var list1 = tracker.GetAllProcesses();
        list1.Should().HaveCount(2);
        list1.Should().AllSatisfy(p => p.Status.Should().Be("Queued"));

        // Act - Update Progress
        tracker.TrackProgress(new ChapterScrapingProgressIntegrationEvent(
            mangaId, "Naruto", ch1, 1.0, 10, 20, 50, "InProgress"));

        var list2 = tracker.GetAllProcesses();
        var proc1 = list2.First(p => p.ChapterId == ch1);
        proc1.Status.Should().Be("InProgress");
        proc1.Percent.Should().Be(50);
        proc1.DownloadedPages.Should().Be(10);
        proc1.TotalPages.Should().Be(20);

        // Act - Cancel specific chapter
        tracker.MarkCancelled(mangaId, ch1, cancelAll: false);
        var proc1Cancelled = tracker.GetAllProcesses().First(p => p.ChapterId == ch1);
        proc1Cancelled.Status.Should().Be("Cancelled");

        // Act - Cancel All
        tracker.MarkCancelled(null, null, cancelAll: true);
        var allList = tracker.GetAllProcesses();
        allList.Should().AllSatisfy(p => p.Status.Should().Be("Cancelled"));
    }

    [Fact]
    public void ScrapingCancellationManager_ShouldCancelRegisteredTokens()
    {
        // Arrange
        var mockLogger = new Mock<ILogger<ScrapingCancellationManager>>();
        var manager = new ScrapingCancellationManager(mockLogger.Object);
        var mangaId = Guid.NewGuid();
        var chId = Guid.NewGuid();

        // Act - Register
        using var cts = manager.Register(mangaId, chId, CancellationToken.None);
        cts.IsCancellationRequested.Should().BeFalse();

        // Act - Cancel specific
        manager.Cancel(mangaId, chId, cancelAll: false);
        cts.IsCancellationRequested.Should().BeTrue();

        // Act - Unregister
        manager.Unregister(chId);
    }

    [Fact]
    public void ScrapingCancellationManager_CancelAll_ShouldCancelAllTokens()
    {
        // Arrange
        var mockLogger = new Mock<ILogger<ScrapingCancellationManager>>();
        var manager = new ScrapingCancellationManager(mockLogger.Object);
        var mangaId = Guid.NewGuid();
        var ch1 = Guid.NewGuid();
        var ch2 = Guid.NewGuid();

        using var cts1 = manager.Register(mangaId, ch1, CancellationToken.None);
        using var cts2 = manager.Register(mangaId, ch2, CancellationToken.None);

        // Act
        manager.Cancel(null, null, cancelAll: true);

        // Assert
        cts1.IsCancellationRequested.Should().BeTrue();
        cts2.IsCancellationRequested.Should().BeTrue();
    }
}
