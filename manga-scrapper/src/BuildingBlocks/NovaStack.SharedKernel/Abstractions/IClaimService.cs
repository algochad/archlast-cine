using System.Collections.Generic;

namespace NovaStack.SharedKernel.Abstractions;

/// <summary>
/// Service to extract claims/identity information about the current user.
/// </summary>
public interface IClaimService
{
    /// <summary>
    /// Gets the current user identifier, if authenticated.
    /// </summary>
    string? GetCurrentUserId();

    /// <summary>
    /// Gets the current user's email, if authenticated.
    /// </summary>
    string? GetCurrentUserEmail();

    /// <summary>
    /// Gets the current user's roles.
    /// </summary>
    IReadOnlyList<string> GetCurrentUserRoles();

    /// <summary>
    /// Gets the client IP address of the current request.
    /// </summary>
    string? GetClientIpAddress();
}

