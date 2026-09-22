using FluentAssertions;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace UnitTests.MangaScrapper;

public class FcmNotificationServiceTests
{
    [Fact]
    public async Task SendNewChapterNotification_WhenFirebaseNotInitialized_ShouldNotThrow()
    {
        // Arrange
        var mockScopeFactory = new Mock<IServiceScopeFactory>();
        var mockLogger = new Mock<ILogger<FcmNotificationService>>();

        var service = new FcmNotificationService(mockScopeFactory.Object, mockLogger.Object);

        // Act
        var act = async () => await service.SendNewChapterNotificationToUserLibraryAsync(
            Guid.NewGuid(),
            "Chainsaw Man",
            150.0,
            "https://example.com/cover.jpg",
            CancellationToken.None);

        // Assert
        await act.Should().NotThrowAsync();
    }
}
