using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using NovaStack.Infrastructure.Caching;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NovaStack.Infrastructure.Authentication;

public sealed class ConfigureJwtBearerOptions : IConfigureNamedOptions<JwtBearerOptions>
{
    private readonly AuthenticationOptions _opts;
    private readonly ICacheService _cacheService;
    private readonly IHttpClientFactory _httpClientFactory;

    public ConfigureJwtBearerOptions(
        IOptions<AuthenticationOptions> authOptions,
        ICacheService cacheService,
        IHttpClientFactory httpClientFactory)
    {
        _opts = authOptions.Value;
        _cacheService = cacheService;
        _httpClientFactory = httpClientFactory;
    }

    public void Configure(string? name, JwtBearerOptions options)
    {
        if (name != JwtBearerDefaults.AuthenticationScheme)
            return;

        options.RequireHttpsMetadata = _opts.RequireHttps;

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = !string.IsNullOrWhiteSpace(_opts.Issuer) || !string.IsNullOrWhiteSpace(_opts.Authority),
            ValidateAudience = _opts.Audiences.Count > 0,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = string.IsNullOrWhiteSpace(_opts.Authority) ? _opts.Issuer : _opts.Authority,
            ValidAudiences = _opts.Audiences,
            ClockSkew = TimeSpan.Zero
        };

        var isClient = !string.IsNullOrWhiteSpace(_opts.Authority) && !_opts.UseLocalValidation;

        if (isClient)
        {
            // Client API VSA: Resolve from JWKS with Caching
            options.TokenValidationParameters.IssuerSigningKeyResolver = (token, securityToken, kid, validationParameters) =>
            {
                return ResolveKeysFromJwks(kid);
            };
        }
        else
        {
            // Identity VSA / Local validation: Resolve from local RSA keys
            var isRsa = string.Equals(_opts.Signing.Algorithm, "RS256", StringComparison.OrdinalIgnoreCase);
            if (isRsa)
            {
                var privateKeyPath = ResolvePath(string.IsNullOrWhiteSpace(_opts.Signing.PrivateKeyPath) ? "keys/private.pem" : _opts.Signing.PrivateKeyPath);
                var publicKeyPath = ResolvePath(string.IsNullOrWhiteSpace(_opts.Signing.PublicKeyPath) ? "keys/public.pem" : _opts.Signing.PublicKeyPath);

                var rsa = LoadOrCreateRsaKeys(privateKeyPath, publicKeyPath);
                var rsaKey = new RsaSecurityKey(rsa)
                {
                    KeyId = string.IsNullOrWhiteSpace(_opts.Signing.KeyId) ? GetStableKeyId(rsa) : _opts.Signing.KeyId
                };

                options.TokenValidationParameters.IssuerSigningKey = rsaKey;
            }
            else
            {
                // Fallback to symmetric signing key
                var secretKey = string.IsNullOrWhiteSpace(_opts.Signing.SymmetricKey)
                    ? "default_dev_key_please_change_me_32chars!"
                    : _opts.Signing.SymmetricKey;
                options.TokenValidationParameters.IssuerSigningKey = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(secretKey));
            }
        }
    }

    public void Configure(JwtBearerOptions options) => Configure(JwtBearerDefaults.AuthenticationScheme, options);

    private IEnumerable<SecurityKey> ResolveKeysFromJwks(string kid)
    {
        if (string.IsNullOrWhiteSpace(kid))
            return Enumerable.Empty<SecurityKey>();

        var authority = _opts.Authority.TrimEnd('/');
        var jwksUri = $"{authority}/.well-known/jwks.json";
        var cacheKey = $"jwks:{jwksUri}";

        // 1. Try Cache memory
        try
        {
            var cachedKeys = _cacheService.GetAsync<List<SerializedJwkDto>>(cacheKey).GetAwaiter().GetResult();
            if (cachedKeys != null)
            {
                var key = cachedKeys.FirstOrDefault(k => k.Kid == kid);
                if (key != null)
                {
                    return new[] { ConvertToSecurityKey(key) };
                }
            }
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning(ex, "Failed to read JWKS from cache key {CacheKey}", cacheKey);
        }

        // 2. Download Public Key on cache miss / key not found
        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            var response = httpClient.GetAsync(jwksUri).GetAwaiter().GetResult();

            if (response.IsSuccessStatusCode)
            {
                var json = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                var document = JsonSerializer.Deserialize<JwksDocumentDto>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                if (document?.Keys != null && document.Keys.Count > 0)
                {
                    // 3. Cache Memory
                    var cacheExpiry = TimeSpan.FromMinutes(_opts.CacheMinutes > 0 ? _opts.CacheMinutes : 60);
                    _cacheService.SetAsync(cacheKey, document.Keys, cacheExpiry).GetAwaiter().GetResult();

                    var key = document.Keys.FirstOrDefault(k => k.Kid == kid);
                    if (key != null)
                    {
                        return new[] { ConvertToSecurityKey(key) };
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Serilog.Log.Error(ex, "Error resolving key {Kid} from JWKS endpoint {JwksUri}", kid, jwksUri);
        }

        return Enumerable.Empty<SecurityKey>();
    }

    private static SecurityKey ConvertToSecurityKey(SerializedJwkDto jwk)
    {
        if (string.Equals(jwk.Kty, "RSA", StringComparison.OrdinalIgnoreCase))
            {
            var rsa = RSA.Create();
            rsa.ImportParameters(new RSAParameters
            {
                Modulus = Base64UrlEncoder.DecodeBytes(jwk.N),
                Exponent = Base64UrlEncoder.DecodeBytes(jwk.E)
            });
            return new RsaSecurityKey(rsa) { KeyId = jwk.Kid };
        }
        throw new NotSupportedException($"JWK key type '{jwk.Kty}' is not supported.");
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
}

public sealed class SerializedJwkDto
{
    [JsonPropertyName("kty")] public string Kty { get; set; } = string.Empty;
    [JsonPropertyName("use")] public string Use { get; set; } = string.Empty;
    [JsonPropertyName("alg")] public string Alg { get; set; } = string.Empty;
    [JsonPropertyName("kid")] public string Kid { get; set; } = string.Empty;
    [JsonPropertyName("n")]   public string N { get; set; } = string.Empty;
    [JsonPropertyName("e")]   public string E { get; set; } = string.Empty;
}

public sealed class JwksDocumentDto
{
    [JsonPropertyName("keys")] public List<SerializedJwkDto> Keys { get; set; } = new();
}
