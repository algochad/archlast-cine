using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using NovaStack.Infrastructure.Authentication;
using NovaStack.Infrastructure.Caching;
using NovaStack.SharedKernel.Abstractions;
using System.Text;

namespace NovaStack.Infrastructure.DependencyInjection;

/// <summary>
/// Extension methods to register all shared infrastructure services.
/// Call this from each service's composition root (Program.cs).
/// </summary>
public static class InfrastructureServiceExtensions
{
    /// <summary>Registers JWT authentication with configuration from <see cref="AuthenticationOptions"/>.</summary>
    public static IServiceCollection AddNovaStackAuth(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddHttpClient();

        services.Configure<AuthenticationOptions>(options =>
        {
            var section = configuration.GetSection(AuthenticationOptions.SectionName);
            section.Bind(options);

            var audienceSection = section.GetSection("Audience");
            if (audienceSection.Exists())
            {
                if (audienceSection.GetChildren().Any())
                {
                    options.Audiences = audienceSection.Get<List<string>>() ?? new List<string>();
                }
                else
                {
                    var singleAudience = audienceSection.Get<string>();
                    if (!string.IsNullOrWhiteSpace(singleAudience))
                    {
                        options.Audiences = new List<string> { singleAudience };
                    }
                }
            }
        });

        services.ConfigureOptions<ConfigureJwtBearerOptions>();

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer();

        services.AddAuthorization();

        services.AddHttpContextAccessor();
        services.AddScoped<IClaimService, ClaimService>();

        // Token generation service (used by Identity.Application handlers)
        services.AddScoped<IJwtTokenService, JwtTokenService>();

        return services;
    }

    /// <summary>Registers caching (in-memory or Redis) based on configuration.</summary>
    public static IServiceCollection AddNovaStackCache(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.Configure<CacheOptions>(configuration.GetSection(CacheOptions.SectionName));

        var cacheOptions = configuration
            .GetSection(CacheOptions.SectionName)
            .Get<CacheOptions>() ?? new CacheOptions();

        if (cacheOptions.Provider == CacheProvider.Redis
            && !string.IsNullOrWhiteSpace(cacheOptions.RedisConnectionString))
        {
            services.AddStackExchangeRedisCache(options =>
            {
                options.Configuration = cacheOptions.RedisConnectionString;
                options.InstanceName = cacheOptions.InstanceName;
            });
            services.AddSingleton<ICacheService>(sp =>
                new RedisCacheService(
                    sp.GetRequiredService<IDistributedCache>(),
                    cacheOptions));
        }
        else
        {
            services.AddMemoryCache();
            services.AddSingleton<ICacheService>(sp =>
                new InMemoryCacheService(
                    sp.GetRequiredService<IMemoryCache>(),
                    cacheOptions));
        }

        return services;
    }

    /// <summary>Registers health checks.</summary>
    public static IServiceCollection AddNovaStackHealthChecks(
        this IServiceCollection services,
        IConfiguration configuration) =>
        services.AddHealthChecks().Services;
}
