using System.Collections.Generic;

namespace NovaStack.Infrastructure.Authentication;

/// <summary>Authentication configuration settings.</summary>
public sealed class AuthenticationOptions
{
    public const string SectionName = "Authentication";

    // OIDC / Identity Service specific settings
    public string Issuer { get; set; } = string.Empty;

    // Client/API Service specific settings
    public string Authority { get; set; } = string.Empty;
    public bool RequireHttps { get; set; } = false;
    public int CacheMinutes { get; set; } = 60;

    // Set to true to validate JWT tokens locally without an external Identity authority
    public bool UseLocalValidation { get; set; } = false;

    // RSA/Symmetric Signing Settings
    public SigningOptions Signing { get; set; } = new();

    // Lifetimes
    public AccessTokenOptions AccessToken { get; set; } = new();
    public RefreshTokenOptions RefreshToken { get; set; } = new();

    // Loaded dynamically from section binding to handle string vs string-array representation
    public List<string> Audiences { get; set; } = new();
}

/// <summary>Options for JWT token signing.</summary>
public sealed class SigningOptions
{
    public string Algorithm { get; set; } = "RS256";
    public string PrivateKeyPath { get; set; } = string.Empty;
    public string PublicKeyPath { get; set; } = string.Empty;
    public string KeyId { get; set; } = string.Empty;
    public string SymmetricKey { get; set; } = string.Empty;
}

/// <summary>Options for Access Token configuration.</summary>
public sealed class AccessTokenOptions
{
    public int LifetimeMinutes { get; set; } = 15;
}

/// <summary>Options for Refresh Token configuration.</summary>
public sealed class RefreshTokenOptions
{
    public int LifetimeDays { get; set; } = 30;
}
