using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Text;

namespace NovaStack.Infrastructure.Authentication;

public class CustomAuthSchemeOptions : AuthenticationSchemeOptions { }

public class CustomAuthValidation : AuthenticationHandler<CustomAuthSchemeOptions>
{
    private readonly IConfiguration _config;

    public CustomAuthValidation(
        IOptionsMonitor<CustomAuthSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IConfiguration config)
        : base(options, logger, encoder)
    {
        _config = config;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // 1. Try JWT
        string? authHeader = Request.Headers.Authorization;
        if (!string.IsNullOrEmpty(authHeader) && authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var token = authHeader.Substring("Bearer ".Length).Trim();
            var jwtResult = ValidateJwt(token);
            if (jwtResult.Succeeded)
            {
                return jwtResult;
            }
        }

        // 2. Try Cookie
        var cookieResult = await Context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        if (cookieResult.Succeeded)
        {
            return cookieResult;
        }

        return AuthenticateResult.NoResult();
    }

    private AuthenticateResult ValidateJwt(string token)
    {
        try
        {
            var key = Encoding.ASCII.GetBytes(_config["JwtSigningKey"] ?? "a_very_secret_key_that_is_at_least_32_chars_long!!");
            var tokenHandler = new JwtSecurityTokenHandler();
            var principal = tokenHandler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(key),
                ValidateIssuer = false,
                ValidateAudience = false,
                ClockSkew = TimeSpan.Zero
            }, out _);

            var ticket = new AuthenticationTicket(principal, Scheme.Name);
            return AuthenticateResult.Success(ticket);
        }
        catch (Exception ex)
        {
            return AuthenticateResult.Fail($"JWT validation failed: {ex.Message}");
        }
    }
}
