using MangaScrapper.Core.ValueObjects;
using NovaStack.SharedKernel.Common;

namespace MangaScrapper.Core.Aggregates;

public class User : Entity<UserId>
{
    public static class UserRoles
    {
        public const string SuperUser = "SuperUser";
        public const string Admin = "Admin";
        public const string User = "User";
    }

    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public List<string> Roles { get; set; } = new();
    public bool IsActive { get; set; } = true;
    public string? FirebaseUid { get; set; }
    public List<string> FcmTokens { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastActiveAt { get; set; }
    public string? ClientIpAddress { get; set; }
    
    private User(UserId id, string username, string passwordHash, string email, List<string> roles, bool isActive, string? firebaseUid, List<string>? fcmTokens, DateTime? createdAt, DateTime? lastActiveAt, string? clientIpAddress)
        : base(id)
    {
        Username = username;
        PasswordHash = passwordHash;
        Email = email;
        Roles = roles;
        IsActive = isActive;
        FirebaseUid = firebaseUid;
        FcmTokens = fcmTokens ?? new();
        CreatedAt = createdAt ?? DateTime.UtcNow;
        LastActiveAt = lastActiveAt;
        ClientIpAddress = clientIpAddress;
    }
    
    public void AddFcmToken(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) return;
        if (!FcmTokens.Contains(token))
        {
            FcmTokens.Add(token);
        }
    }

    public void RemoveFcmToken(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) return;
        FcmTokens.Remove(token);
    }
    
    public static User Create(UserId id, string username, string passwordHash, string email, List<string> roles, string? firebaseUid = null, List<string>? fcmTokens = null, DateTime? lastActiveAt = null, string? clientIpAddress = null)
    {
        return new User(id, username, passwordHash, email, roles, true, firebaseUid, fcmTokens, DateTime.UtcNow, lastActiveAt, clientIpAddress);
    }

    public static User Reconstitute(UserId id, string username, string passwordHash, string email, List<string> roles, bool isActive, string? firebaseUid, List<string>? fcmTokens, DateTime? createdAt, DateTime? lastActiveAt, string? clientIpAddress)
    {
        return new User(id, username, passwordHash, email, roles, isActive, firebaseUid, fcmTokens, createdAt, lastActiveAt, clientIpAddress);
    }
}