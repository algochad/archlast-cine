using System.Reflection;
using Mapster;
using MapsterMapper;
using Microsoft.Extensions.DependencyInjection;

namespace NovaStack.Infrastructure.DependencyInjection;

/// <summary>
/// Extension methods for registering Mapster object mapping dependencies.
/// </summary>
public static class MapsterExtensions
{
    /// <summary>
    /// Registers Mapster mapper and scans the target assembly for configuration profiles (classes implementing <see cref="IRegister"/>).
    /// </summary>
    public static IServiceCollection AddNovaStackMappings(this IServiceCollection services, Assembly assembly)
    {
        var config = TypeAdapterConfig.GlobalSettings;
        
        // Scan assembly for IRegister implementations
        config.Scan(assembly);

        // Register configuration and mapper as dependencies
        services.AddSingleton(config);
        services.AddScoped<IMapper, Mapper>();

        return services;
    }
}
