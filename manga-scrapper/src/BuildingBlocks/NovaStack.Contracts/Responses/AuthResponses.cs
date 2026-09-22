namespace NovaStack.Contracts.Responses;

public record LoginRequest(string Username, string Password);

public record LoginResponse(
    string Token,
    DateTime Expiry,
    string Username,
    Guid UserId);

public record FirebaseVerifyRequest(string IdToken);

public record RegisterRequest(string Username, string Password, string Email);

public record UserInfoResponse(
    bool IsAuthenticated,
    string UserId,
    string Username,
    string Email,
    List<string> Roles,
    string FirebaseUid);

public record UserResponse(
    Guid UserId,
    string Username,
    string Email,
    List<string> Roles,
    bool IsActive,
    string? FirebaseUid,
    DateTime CreatedAt,
    DateTime? LastActiveAt,
    string? ClientIpAddress = null);

public record UserHeartbeatResponse(
    Guid UserId,
    string Username,
    DateTime LastActiveAt,
    string? ClientIpAddress = null);

