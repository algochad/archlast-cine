using Microsoft.Extensions.DependencyInjection;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Bson.Serialization.Conventions;
using MongoDB.Bson.Serialization.Serializers;

namespace NovaStack.Infrastructure.Persistence.MongoDb;

public static class MongoDbConfigurationExtensions
{
    private static bool _isConfigured;

    /// <summary>
    /// Configures MongoDB global conventions and serializers. Should be called once during startup.
    /// </summary>
    public static IServiceCollection ConfigureMongoDbGlobalConventions(this IServiceCollection services)
    {
        if (_isConfigured) return services;
        _isConfigured = true;

        var conventionPack = new ConventionPack { new CamelCaseElementNameConvention() };
        ConventionRegistry.Register("camelCase", conventionPack, t => true);

        BsonSerializer.RegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));

        return services;
    }
}
