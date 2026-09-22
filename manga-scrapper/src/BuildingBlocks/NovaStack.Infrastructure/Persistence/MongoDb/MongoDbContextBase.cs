using MongoDB.Driver;

namespace NovaStack.Infrastructure.Persistence.MongoDb;

/// <summary>
/// Base class for MongoDB contexts. Wraps <see cref="IMongoDatabase"/> and implements
/// <see cref="IMongoDbContext"/>. Derive from this in each service to expose
/// strongly-typed collection properties.
/// </summary>
/// <remarks>
/// Unlike the EF Core <c>DbContextBase</c>, this class does NOT intercept domain events or
/// manage an outbox table. Domain events raised in MongoDB-backed services are published
/// directly via <see cref="NovaStack.SharedKernel.Abstractions.IEventBus"/> after the
/// write operation completes (fire-and-forget style). Implement a compensating saga or
/// an explicit MongoDB outbox collection if at-least-once delivery is required.
/// </remarks>
public abstract class MongoDbContextBase : IMongoDbContext
{
    private readonly IMongoDatabase _database;

    protected MongoDbContextBase(IMongoClient client, string databaseName)
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentException.ThrowIfNullOrWhiteSpace(databaseName);

        _database = client.GetDatabase(databaseName);
    }

    /// <inheritdoc />
    public IMongoCollection<T> GetCollection<T>(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return _database.GetCollection<T>(name);
    }
}
