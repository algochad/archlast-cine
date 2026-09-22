using System.Net;
using System.Security.Claims;
using FluentAssertions;
using MangaScrapper.Core.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace UnitTests.MangaScrapper;

public class RateLimitingTests
{
    [Fact]
    public void RateLimitPolicies_ShouldHaveExpectedConstants()
    {
        RateLimitPolicies.Default.Should().Be("Default");
        RateLimitPolicies.MangaView.Should().Be("MangaView");
        RateLimitPolicies.SemanticSearch.Should().Be("SemanticSearch");
        RateLimitPolicies.VectorSearch.Should().Be("VectorSearch");
        RateLimitPolicies.Auth.Should().Be("Auth");
        RateLimitPolicies.Scraping.Should().Be("Scraping");
        RateLimitPolicies.ImageProxy.Should().Be("ImageProxy");
    }

    [Fact]
    public void RateLimitingOptions_Defaults_ShouldBeReasonable()
    {
        var options = new RateLimitingOptions();

        options.Enabled.Should().BeTrue();
        options.Global.PermitLimit.Should().Be(300);
        options.Global.WindowSeconds.Should().Be(60);

        options.Default.PermitLimit.Should().Be(120);
        options.MangaView.PermitLimit.Should().Be(30);
        options.SemanticSearch.PermitLimit.Should().Be(15);
        options.VectorSearch.PermitLimit.Should().Be(30);
        options.Auth.PermitLimit.Should().Be(10);
        options.Scraping.PermitLimit.Should().Be(20);
        options.ImageProxy.PermitLimit.Should().Be(100);
    }

    [Fact]
    public void GetPartitionKey_WhenUserIsAuthenticated_ShouldReturnUserPartition()
    {
        // Arrange
        var context = new DefaultHttpContext();
        var userId = Guid.NewGuid().ToString();
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, userId) };
        var identity = new ClaimsIdentity(claims, "TestAuth");
        context.User = new ClaimsPrincipal(identity);

        // Act
        var key = RateLimitingExtensions.GetPartitionKey(context);

        // Assert
        key.Should().Be($"usr:{userId}");
    }

    [Fact]
    public void GetPartitionKey_WhenAnonymousWithClientIp_ShouldReturnIpPartition()
    {
        // Arrange
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse("192.168.1.50");

        // Act
        var key = RateLimitingExtensions.GetPartitionKey(context);

        // Assert
        key.Should().Be("ip:192.168.1.50");
    }

    [Fact]
    public void GetPartitionKey_WhenCloudflareHeaderPresent_ShouldUseCloudflareIp()
    {
        // Arrange
        var context = new DefaultHttpContext();
        context.Request.Headers["CF-Connecting-IP"] = "203.0.113.195";
        context.Connection.RemoteIpAddress = IPAddress.Parse("10.0.0.1");

        // Act
        var key = RateLimitingExtensions.GetPartitionKey(context);

        // Assert
        key.Should().Be("ip:203.0.113.195");
    }

    [Fact]
    public void GetPartitionKey_WhenNoUserAndNoIp_ShouldReturnFallback()
    {
        // Arrange
        var context = new DefaultHttpContext();

        // Act
        var key = RateLimitingExtensions.GetPartitionKey(context);

        // Assert
        key.Should().Be("anon:unknown");
    }

    [Fact]
    public void AddMangaScrapperRateLimiting_ShouldRegisterOptionsAndServices()
    {
        // Arrange
        var inMemorySettings = new Dictionary<string, string?>
        {
            ["RateLimiting:Enabled"] = "true",
            ["RateLimiting:MangaView:PermitLimit"] = "45",
            ["RateLimiting:MangaView:WindowSeconds"] = "30",
            ["RateLimiting:Auth:PermitLimit"] = "5"
        };

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(inMemorySettings)
            .Build();

        var services = new ServiceCollection();

        // Act
        services.AddMangaScrapperRateLimiting(configuration);
        var provider = services.BuildServiceProvider();

        // Assert
        var options = provider.GetRequiredService<IOptions<RateLimitingOptions>>().Value;
        options.Should().NotBeNull();
        options.Enabled.Should().BeTrue();
        options.MangaView.PermitLimit.Should().Be(45);
        options.MangaView.WindowSeconds.Should().Be(30);
        options.Auth.PermitLimit.Should().Be(5);
        // Untouched settings retain defaults
        options.SemanticSearch.PermitLimit.Should().Be(15);
    }
}
