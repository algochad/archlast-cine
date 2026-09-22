namespace NovaStack.Contracts.IntegrationEvents;

/// <summary>
/// Integration event published to trigger storage synchronization.
/// Consumed by the Scrapper.Worker via RabbitMQ.
/// </summary>
public sealed record SyncStorageIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(SyncStorageIntegrationEvent);

    public SyncStorageIntegrationEvent() { }
}

/// <summary>
/// Integration event published to trigger Qdrant (vector db) synchronization.
/// Consumed by the Scrapper.Worker via RabbitMQ.
/// </summary>
public sealed record SyncQdrantIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(SyncQdrantIntegrationEvent);

    public SyncQdrantIntegrationEvent() { }
}

/// <summary>
/// Integration event published to trigger Meilisearch (search db) synchronization.
/// Consumed by the Scrapper.Worker via RabbitMQ.
/// </summary>
public sealed record SyncMeilisearchIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(SyncMeilisearchIntegrationEvent);

    public SyncMeilisearchIntegrationEvent() { }
}

/// <summary>
/// Integration event published to trigger AniList metadata synchronization.
/// Consumed by the Scrapper.Worker via RabbitMQ.
/// </summary>
public sealed record SyncAnilistIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType { get; init; } = nameof(SyncAnilistIntegrationEvent);

    public SyncAnilistIntegrationEvent() { }
}
