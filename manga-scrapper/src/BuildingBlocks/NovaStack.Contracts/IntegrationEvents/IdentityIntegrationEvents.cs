namespace NovaStack.Contracts.IntegrationEvents;

/// <summary>Published when a new user completes registration in the Identity service.</summary>
public sealed record UserRegisteredIntegrationEvent(
    Guid UserId,
    string Email,
    string FirstName,
    string LastName,
    DateTime RegisteredAt) : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType => nameof(UserRegisteredIntegrationEvent);
}

/// <summary>Published when a user's roles are assigned or revoked.</summary>
public sealed record UserRoleChangedIntegrationEvent(
    Guid UserId,
    string Email,
    IReadOnlyList<string> CurrentRoles,
    string ChangeType,   // "Assigned" | "Revoked"
    string ChangedRole,
    DateTime ChangedAt) : IIntegrationEvent
{
    public Guid EventId { get; init; } = Guid.CreateVersion7();
    public DateTime OccurredOn { get; init; } = DateTime.UtcNow;
    public string EventType => nameof(UserRoleChangedIntegrationEvent);
}
