using FluentAssertions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Moq;
using Moq.Protected;
using NovaStack.Infrastructure.Authentication;
using NovaStack.Infrastructure.Caching;
using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace UnitTests.Authentication;

public sealed class JwksTokenValidationTests : IDisposable
{
    private readonly string _tempPrivateKeyPath;
    private readonly string _tempPublicKeyPath;

    public JwksTokenValidationTests()
    {
        var runId = Guid.CreateVersion7().ToString("N");
        _tempPrivateKeyPath = Path.Combine(AppContext.BaseDirectory, $"private_{runId}.pem");
        _tempPublicKeyPath = Path.Combine(AppContext.BaseDirectory, $"public_{runId}.pem");
    }

    public void Dispose()
    {
        if (File.Exists(_tempPrivateKeyPath)) File.Delete(_tempPrivateKeyPath);
        if (File.Exists(_tempPublicKeyPath)) File.Delete(_tempPublicKeyPath);
    }

    [Fact]
    public void JwtTokenService_ShouldGenerateRsaKeysAndToken_WhenUseRsaIsConfigured()
    {
        // Arrange
        var options = new AuthenticationOptions
        {
            Issuer = "http://localhost:5010",
            AccessToken = new AccessTokenOptions { LifetimeMinutes = 15 },
            Signing = new SigningOptions
            {
                Algorithm = "RS256",
                PrivateKeyPath = _tempPrivateKeyPath,
                PublicKeyPath = _tempPublicKeyPath,
                KeyId = "test-key-id"
            }
        };
        var authOptions = Options.Create(options);
        var tokenService = new JwtTokenService(authOptions);

        // Act
        var tokenString = tokenService.GenerateAccessToken(
            userId: Guid.CreateVersion7(),
            email: "test@novastack.local",
            roles: new[] { "Admin", "User" }
        );

        var pubKeyDto = tokenService.GetPublicKeyDto();

        // Assert
        tokenString.Should().NotBeNullOrWhiteSpace();
        pubKeyDto.Should().NotBeNull();
        pubKeyDto.Kid.Should().Be("test-key-id");
        pubKeyDto.Alg.Should().Be(SecurityAlgorithms.RsaSha256);
        pubKeyDto.Kty.Should().Be("RSA");
        pubKeyDto.N.Should().NotBeNullOrEmpty();
        pubKeyDto.E.Should().NotBeNullOrEmpty();

        File.Exists(_tempPrivateKeyPath).Should().BeTrue();
        File.Exists(_tempPublicKeyPath).Should().BeTrue();

        var handler = new JwtSecurityTokenHandler();
        var token = handler.ReadJwtToken(tokenString);
        token.Header.Alg.Should().Be("RS256");
        token.Header.Kid.Should().Be("test-key-id");
    }

    [Fact]
    public void ConfigureJwtBearerOptions_ShouldResolveAndCacheJwksKeys_OnCacheMiss()
    {
        // Arrange
        var jwtOptions = new AuthenticationOptions
        {
            Authority = "http://localhost:5010",
            Audiences = new List<string> { "product-api" },
            RequireHttps = false,
            CacheMinutes = 30
        };

        var mockCache = new Mock<ICacheService>();
        // Simulate cache miss
        mockCache.Setup(c => c.GetAsync<List<SerializedJwkDto>>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((List<SerializedJwkDto>?)null);

        // Simulated JWKS Response
        var rsa = RSA.Create(2048);
        var parameters = rsa.ExportParameters(false);
        var jwk = new SerializedJwkDto
        {
            Kty = "RSA",
            Use = "sig",
            Alg = SecurityAlgorithms.RsaSha256,
            Kid = "forge-key-2026",
            N = Base64UrlEncoder.Encode(parameters.Modulus),
            E = Base64UrlEncoder.Encode(parameters.Exponent)
        };
        var jwksDoc = new JwksDocumentDto { Keys = new List<SerializedJwkDto> { jwk } };
        var jsonResponse = JsonSerializer.Serialize(jwksDoc);

        var httpClientFactory = CreateMockHttpClientFactory(jsonResponse);

        var configure = new ConfigureJwtBearerOptions(Options.Create(jwtOptions), mockCache.Object, httpClientFactory);
        var jwtBearerOptions = new JwtBearerOptions();

        // Act
        configure.Configure(JwtBearerDefaults.AuthenticationScheme, jwtBearerOptions);

        var resolver = jwtBearerOptions.TokenValidationParameters.IssuerSigningKeyResolver;
        resolver.Should().NotBeNull();

        var resolvedKeys = resolver!(
            token: "dummy-token",
            securityToken: null!,
            kid: "forge-key-2026",
            validationParameters: jwtBearerOptions.TokenValidationParameters
        ).ToList();

        // Assert
        resolvedKeys.Should().HaveCount(1);
        resolvedKeys[0].KeyId.Should().Be("forge-key-2026");
        resolvedKeys[0].Should().BeOfType<RsaSecurityKey>();

        // Verify key is cached
        mockCache.Verify(c => c.SetAsync(
            It.Is<string>(k => k == "jwks:http://localhost:5010/.well-known/jwks.json"),
            It.Is<List<SerializedJwkDto>>(list => list.Any(k => k.Kid == "forge-key-2026")),
            It.Is<TimeSpan>(t => t == TimeSpan.FromMinutes(30)),
            It.IsAny<CancellationToken>()
        ), Times.Once);
    }

    [Fact]
    public void ConfigureJwtBearerOptions_ShouldUseCachedKeys_OnCacheHit()
    {
        // Arrange
        var jwtOptions = new AuthenticationOptions
        {
            Authority = "http://localhost:5010",
            Audiences = new List<string> { "product-api" },
            RequireHttps = false,
            CacheMinutes = 30
        };

        var mockCache = new Mock<ICacheService>();
        var rsa = RSA.Create(2048);
        var parameters = rsa.ExportParameters(false);
        var cachedJwk = new SerializedJwkDto
        {
            Kty = "RSA",
            Use = "sig",
            Alg = SecurityAlgorithms.RsaSha256,
            Kid = "cached-key-id",
            N = Base64UrlEncoder.Encode(parameters.Modulus),
            E = Base64UrlEncoder.Encode(parameters.Exponent)
        };
        // Simulate cache hit
        mockCache.Setup(c => c.GetAsync<List<SerializedJwkDto>>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<SerializedJwkDto> { cachedJwk });

        var mockHttp = new Mock<IHttpClientFactory>(); // Not called because cache hits!

        var configure = new ConfigureJwtBearerOptions(Options.Create(jwtOptions), mockCache.Object, mockHttp.Object);
        var jwtBearerOptions = new JwtBearerOptions();
        configure.Configure(JwtBearerDefaults.AuthenticationScheme, jwtBearerOptions);

        // Act
        var resolver = jwtBearerOptions.TokenValidationParameters.IssuerSigningKeyResolver;
        var resolvedKeys = resolver!(
            token: "dummy",
            securityToken: null!,
            kid: "cached-key-id",
            validationParameters: jwtBearerOptions.TokenValidationParameters
        ).ToList();

        // Assert
        resolvedKeys.Should().HaveCount(1);
        resolvedKeys[0].KeyId.Should().Be("cached-key-id");
        mockCache.Verify(c => c.GetAsync<List<SerializedJwkDto>>(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
        // Verify no HTTP calls were made
        mockHttp.Verify(f => f.CreateClient(It.IsAny<string>()), Times.Never);
    }

    private static IHttpClientFactory CreateMockHttpClientFactory(string jwksJson)
    {
        var mockMessageHandler = new Mock<HttpMessageHandler>();
        mockMessageHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(jwksJson)
            });

        var httpClient = new HttpClient(mockMessageHandler.Object);
        var mockFactory = new Mock<IHttpClientFactory>();
        mockFactory.Setup(f => f.CreateClient(It.IsAny<string>())).Returns(httpClient);
        return mockFactory.Object;
    }
}
