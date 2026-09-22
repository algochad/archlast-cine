using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace MangaScrapper.Core.Security;

public class JwtAuthTokenService(IConfiguration configuration) : IAuthTokenService
{
    public (string Token, DateTime Expiry) GenerateToken(User user, int expiryDays = 7)
    {
        var key = Encoding.ASCII.GetBytes(
            configuration["JwtSigningKey"] ?? "a_very_secret_key_that_is_at_least_32_chars_long!!");
        var expiry = DateTime.UtcNow.AddDays(expiryDays);

        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.Value.ToString()),
            new Claim(ClaimTypes.Name, user.Email),
            new Claim("Username", user.Username)
        };

        if (!string.IsNullOrEmpty(user.FirebaseUid))
        {
            claims.Add(new Claim("FirebaseUid", user.FirebaseUid));
        }

        foreach (var role in user.Roles)
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
        }

        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Expires = expiry,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(key),
                SecurityAlgorithms.HmacSha256Signature)
        };

        var tokenHandler = new JwtSecurityTokenHandler();
        var token = tokenHandler.CreateToken(tokenDescriptor);
        return (tokenHandler.WriteToken(token), expiry);
    }
}
