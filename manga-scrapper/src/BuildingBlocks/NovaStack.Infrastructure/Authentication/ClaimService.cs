using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using NovaStack.SharedKernel.Abstractions;

namespace NovaStack.Infrastructure.Authentication;

public sealed class ClaimService(IHttpContextAccessor httpContextAccessor) : IClaimService
{
    public string? GetCurrentUserId()
    {
        var user = httpContextAccessor.HttpContext?.User;
        return user?.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? user?.FindFirstValue("sub")
            ?? user?.FindFirstValue("nameid");
    }

    public string? GetCurrentUserEmail()
    {
        var user = httpContextAccessor.HttpContext?.User;
        return user?.FindFirstValue(ClaimTypes.Email)
            ?? user?.FindFirstValue("email");
    }

    public IReadOnlyList<string> GetCurrentUserRoles()
    {
        var user = httpContextAccessor.HttpContext?.User;
        if (user is null)
        {
            return [];
        }

        return user.FindAll(ClaimTypes.Role)
            .Select(c => c.Value)
            .Concat(user.FindAll("role").Select(c => c.Value))
            .Concat(user.FindAll("roles").Select(c => c.Value))
            .Distinct()
            .ToList();
    }

    public string? GetClientIpAddress()
    {
        return NovaStack.Infrastructure.Http.HttpContextExtensions.GetClientIpAddress(httpContextAccessor.HttpContext);
    }
}

