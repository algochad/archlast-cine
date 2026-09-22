namespace NovaStack.Contracts.IntegrationEvents;

/// <summary>Published when a product is created successfully.</summary>
public sealed record ProductCreatedIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType => nameof(ProductCreatedIntegrationEvent);

    public required Guid ProductId { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required decimal Price { get; init; }
    public required string Currency { get; init; }
    public required int StockQuantity { get; init; }
}

/// <summary>Published when a product is updated.</summary>
public sealed record ProductUpdatedIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType => nameof(ProductUpdatedIntegrationEvent);

    public required Guid ProductId { get; init; }
    public required string Name { get; init; }
    public required decimal Price { get; init; }
    public required string Currency { get; init; }
}

/// <summary>Published when a product is deleted.</summary>
public sealed record ProductDeletedIntegrationEvent : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType => nameof(ProductDeletedIntegrationEvent);

    public required Guid ProductId { get; init; }
}
