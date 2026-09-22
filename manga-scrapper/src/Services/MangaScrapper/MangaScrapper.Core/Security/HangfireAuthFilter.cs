using Hangfire.Dashboard;

namespace MangaScrapper.Core.Security;

/// <summary>
/// Hangfire dashboard authorization filter — only authenticated users can access the dashboard.
/// </summary>
public class HangfireAuthFilter : IDashboardAuthorizationFilter
{
    public bool Authorize(DashboardContext context)
    {
        var httpContext = context.GetHttpContext();
        return httpContext.User.Identity?.IsAuthenticated ?? false;
    }
}
