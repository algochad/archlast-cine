using FluentAssertions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Features.Users.RegisterFcmToken;
using MangaScrapper.Core.Features.Users.UnregisterFcmToken;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.ValueObjects;
using Moq;
using Xunit;

namespace UnitTests.MangaScrapper;

public class FcmTokenHandlerTests
{
    [Fact]
    public async Task RegisterFcmToken_WhenUserExists_ShouldAddToken()
    {
        // Arrange
        var mockUserRepo = new Mock<IUserRepository>();
        var userId = Guid.NewGuid();
        var user = User.Create(UserId.From(userId), "testuser", "hash", "test@example.com", new List<string> { "User" });

        mockUserRepo.Setup(r => r.GetByIdAsync(UserId.From(userId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);

        var handler = new RegisterFcmTokenCommandHandler(mockUserRepo.Object);
        var command = new RegisterFcmTokenCommand(userId, "sample-fcm-token-12345");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        mockUserRepo.Verify(r => r.AddFcmTokenAsync(UserId.From(userId), "sample-fcm-token-12345", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task UnregisterFcmToken_WhenUserExists_ShouldRemoveToken()
    {
        // Arrange
        var mockUserRepo = new Mock<IUserRepository>();
        var userId = Guid.NewGuid();
        var user = User.Create(UserId.From(userId), "testuser", "hash", "test@example.com", new List<string> { "User" }, fcmTokens: new List<string> { "sample-fcm-token-12345" });

        mockUserRepo.Setup(r => r.GetByIdAsync(UserId.From(userId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(user);

        var handler = new UnregisterFcmTokenCommandHandler(mockUserRepo.Object);
        var command = new UnregisterFcmTokenCommand(userId, "sample-fcm-token-12345");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        mockUserRepo.Verify(r => r.RemoveFcmTokenAsync(UserId.From(userId), "sample-fcm-token-12345", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RegisterFcmToken_WhenUserDoesNotExist_ShouldReturnNotFound()
    {
        // Arrange
        var mockUserRepo = new Mock<IUserRepository>();
        var userId = Guid.NewGuid();

        mockUserRepo.Setup(r => r.GetByIdAsync(UserId.From(userId), It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);

        var handler = new RegisterFcmTokenCommandHandler(mockUserRepo.Object);
        var command = new RegisterFcmTokenCommand(userId, "sample-fcm-token-12345");

        // Act
        var result = await handler.Handle(command, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("User.NotFound");
    }
}
