using FluentAssertions;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace UnitTests.MangaScrapper;

public class OnnxEmbeddingServiceTests
{
    [Fact]
    public async Task GenerateEmbeddingAsync_WhenTextIsEmpty_ReturnsNull()
    {
        // Arrange
        var config = Options.Create(new EmbeddingConfig
        {
            ModelPath = "non_existent_model.onnx",
            TokenizerPath = "non_existent_tokenizer.json"
        });
        var logger = new Mock<ILogger<OnnxEmbeddingService>>();
        var httpFactory = new Mock<IHttpClientFactory>();

        using var service = new OnnxEmbeddingService(config, logger.Object, httpFactory.Object);

        // Act
        var result = await service.GenerateEmbeddingAsync(string.Empty);

        // Assert
        result.Should().BeNull();
    }
}
