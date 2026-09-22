using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace NovaStack.Infrastructure.Authentication;

public static class AuthExtensions
{
    public static IServiceCollection AddMangaScrapperAuth(
        this IServiceCollection services,
        IHostEnvironment environment)
    {
        services.AddAuthentication(o =>
            {
                o.DefaultScheme = "CustomAuth";
                o.DefaultAuthenticateScheme = "CustomAuth";
                o.DefaultChallengeScheme = "CustomAuth";
            })
            .AddCookie(CookieAuthenticationDefaults.AuthenticationScheme, options =>
            {
                options.ExpireTimeSpan = TimeSpan.FromDays(3);
                options.SlidingExpiration = true;
                options.AccessDeniedPath = "/Forbidden/";
                options.LoginPath = "/";
                options.LogoutPath = "/api/auth/logout";
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            })
            .AddScheme<CustomAuthSchemeOptions, CustomAuthValidation>("CustomAuth", null);
        
        services.AddAuthorization();

        var keysFolder = Path.Combine(environment.ContentRootPath, "temp-keys");

        services.AddDataProtection()
            .PersistKeysToFileSystem(new DirectoryInfo(keysFolder))
            .SetApplicationName("MangaScrapper");

        return services;
    }
}
