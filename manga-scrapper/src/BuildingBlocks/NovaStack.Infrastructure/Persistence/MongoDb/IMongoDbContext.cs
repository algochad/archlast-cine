using MongoDB.Driver;

namespace NovaStack.Infrastructure.Persistence.MongoDb;

/// <summary>
/// Defines the contract for a MongoDB database context.
/// Implement this to expose typed collection accessors.
/// </summary>
public interface IMongoDbContext
{
    /// <summary>Returns a MongoDB collection by name.</summary>
    IMongoCollection<T> GetCollection<T>(string name);
}
