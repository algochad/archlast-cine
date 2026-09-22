using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace NovaStack.Infrastructure.Authentication;

/// <summary>
/// Concrete implementation of <see cref="IJwtTokenService"/> supporting RS256 and HS256 signing.
/// </summary>
public sealed class JwtTokenService : IJwtTokenService
{
    private readonly AuthenticationOptions _opts;
    private readonly RSA? _rsa;
    private readonly RsaSecurityKey? _rsaSigningKey;
    private readonly SymmetricSecurityKey? _symmetricSigningKey;
    private readonly string _kid = string.Empty;
    private readonly bool _useRsa;

    public JwtTokenService(IOptions<AuthenticationOptions> authOptions)
    {
        _opts = authOptions.Value;
        _useRsa = string.Equals(_opts.Signing.Algorithm, "RS256", StringComparison.OrdinalIgnoreCase);

        if (_useRsa)
        {
            var privateKeyPath = ResolvePath(string.IsNullOrWhiteSpace(_opts.Signing.PrivateKeyPath) ? "keys/private.pem" : _opts.Signing.PrivateKeyPath);
            var publicKeyPath = ResolvePath(string.IsNullOrWhiteSpace(_opts.Signing.PublicKeyPath) ? "keys/public.pem" : _opts.Signing.PublicKeyPath);

            _rsa = LoadOrCreateRsaKeys(privateKeyPath, publicKeyPath);
            _rsaSigningKey = new RsaSecurityKey(_rsa);

            _kid = string.IsNullOrWhiteSpace(_opts.Signing.KeyId) ? GetStableKeyId(_rsa) : _opts.Signing.KeyId;
            _rsaSigningKey.KeyId = _kid;
        }
        else
        {
            var secretKey = string.IsNullOrWhiteSpace(_opts.Signing.SymmetricKey)
                ? "default_dev_key_please_change_me_32chars!"
                : _opts.Signing.SymmetricKey;
            _symmetricSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey));
        }
    }

    private static string ResolvePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return string.Empty;
        return Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, path));
    }

    private static string GetStableKeyId(RSA rsa)
    {
        using var sha256 = SHA256.Create();
        var modulus = rsa.ExportParameters(false).Modulus ?? Array.Empty<byte>();
        var hash = sha256.ComputeHash(modulus);
        return Convert.ToBase64String(hash)
            .Replace('+', '-')
            .Replace('/', '_')
            .Replace("=", "");
    }

    private static RSA LoadOrCreateRsaKeys(string privateKeyPath, string publicKeyPath)
    {
        var rsa = RSA.Create(2048);

        if (File.Exists(privateKeyPath))
        {
            var privatePem = File.ReadAllText(privateKeyPath);
            rsa.ImportFromPem(privatePem);
            return rsa;
        }

        var dir = Path.GetDirectoryName(privateKeyPath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var privateKeyPem = rsa.ExportPkcs8PrivateKeyPem();
        File.WriteAllText(privateKeyPath, privateKeyPem);

        var pubDir = Path.GetDirectoryName(publicKeyPath);
        if (!string.IsNullOrEmpty(pubDir) && !Directory.Exists(pubDir))
        {
            Directory.CreateDirectory(pubDir);
        }

        var publicKeyPem = rsa.ExportSubjectPublicKeyInfoPem();
        File.WriteAllText(publicKeyPath, publicKeyPem);

        return rsa;
    }

    public string GenerateAccessToken(
        Guid userId,
        string email,
        IEnumerable<string> roles,
        IEnumerable<Claim>? extraClaims = null)
    {
        SigningCredentials credentials;
        if (_useRsa)
        {
            credentials = new SigningCredentials(_rsaSigningKey, SecurityAlgorithms.RsaSha256);
        }
        else
        {
            credentials = new SigningCredentials(_symmetricSigningKey, SecurityAlgorithms.HmacSha256);
        }

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new(JwtRegisteredClaimNames.Jti, Guid.CreateVersion7().ToString()),
            new(JwtRegisteredClaimNames.Iat,
                DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(),
                ClaimValueTypes.Integer64),
        };

        claims.AddRange(roles.Select(r => new Claim(ClaimTypes.Role, r)));

        // Support default OIDC scope
        claims.Add(new Claim("scope", "openid profile email"));

        if (extraClaims is not null)
            claims.AddRange(extraClaims);

        var token = new JwtSecurityToken(
            issuer: _opts.Issuer,
            audience: _opts.Audiences.Count > 0 ? _opts.Audiences[0] : "NovaStack.Clients",
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.AddMinutes(_opts.AccessToken.LifetimeMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string GenerateRefreshToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(64);
        return Convert.ToBase64String(bytes);
    }

    public ClaimsPrincipal? GetPrincipalFromExpiredToken(string token)
    {
        TokenValidationParameters validationParameters;
        if (_useRsa)
        {
            validationParameters = new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = _rsaSigningKey,
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateLifetime = false,
                ClockSkew = TimeSpan.Zero
            };
        }
        else
        {
            validationParameters = new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = _symmetricSigningKey,
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateLifetime = false,
                ClockSkew = TimeSpan.Zero
            };
        }

        try
        {
            var principal = new JwtSecurityTokenHandler()
                .ValidateToken(token, validationParameters, out var securityToken);

            if (securityToken is not JwtSecurityToken jwt)
                return null;

            var expectedAlg = _useRsa ? SecurityAlgorithms.RsaSha256 : SecurityAlgorithms.HmacSha256;
            if (!jwt.Header.Alg.Equals(expectedAlg, StringComparison.OrdinalIgnoreCase))
                return null;

            return principal;
        }
        catch
        {
            return null;
        }
    }

    public JwkDto GetPublicKeyDto()
    {
        if (!_useRsa || _rsa is null)
        {
            throw new InvalidOperationException("Public key details are only available when RS256 signing is enabled.");
        }

        var parameters = _rsa.ExportParameters(false);
        return new JwkDto(
            Kty: "RSA",
            Use: "sig",
            Alg: SecurityAlgorithms.RsaSha256,
            Kid: _kid,
            N: Base64UrlEncoder.Encode(parameters.Modulus),
            E: Base64UrlEncoder.Encode(parameters.Exponent)
        );
    }
}
