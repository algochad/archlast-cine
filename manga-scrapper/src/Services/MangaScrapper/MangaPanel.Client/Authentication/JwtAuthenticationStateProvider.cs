using System.Net.Http.Json;
using System.Security.Claims;
using NovaStack.Contracts.Responses;
using Microsoft.AspNetCore.Components.Authorization;

namespace MangaPanel.Client.Authentication;

public class JwtAuthenticationStateProvider : AuthenticationStateProvider, IDisposable
{
    private readonly HttpClient _http;
    private Timer? _heartbeatTimer;

    public JwtAuthenticationStateProvider(HttpClient http)
    {
        _http = http;
    }

    public override async Task<AuthenticationState> GetAuthenticationStateAsync()
    {
        try
        {
            var apiResponse = await _http.GetFromJsonAsync<ApiResponse<UserInfoResponse>>("api/v1/auth/me");
            var userInfo = apiResponse?.Data;

            if (userInfo == null || !userInfo.IsAuthenticated)
            {
                StopHeartbeatTimer();
                return new AuthenticationState(new ClaimsPrincipal(new ClaimsIdentity()));
            }

            // Trigger immediate heartbeat and start periodic timer
            _ = SendHeartbeatAsync();
            StartHeartbeatTimer();

            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, userInfo.UserId),
                new Claim(ClaimTypes.Name, userInfo.Username),
                new Claim("Username", userInfo.Username),
                new Claim(ClaimTypes.Email, userInfo.Email)
            };
            
            foreach (var role in userInfo.Roles)
            {
                claims.Add(new Claim(ClaimTypes.Role, role));
            }

            var identity = new ClaimsIdentity(claims, "Cookie");
            return new AuthenticationState(new ClaimsPrincipal(identity));
        }
        catch
        {
            StopHeartbeatTimer();
            return new AuthenticationState(new ClaimsPrincipal(new ClaimsIdentity()));
        }
    }

    public async Task SendHeartbeatAsync()
    {
        try
        {
            await _http.PatchAsync("api/v1/users/heartbeat", null);
        }
        catch
        {
            // Ignore background heartbeat failures
        }
    }

    private void StartHeartbeatTimer()
    {
        if (_heartbeatTimer is null)
        {
            // Send heartbeat periodically every 1 minute
            _heartbeatTimer = new Timer(async _ =>
            {
                await SendHeartbeatAsync();
            }, null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
        }
    }

    private void StopHeartbeatTimer()
    {
        _heartbeatTimer?.Dispose();
        _heartbeatTimer = null;
    }

    public void NotifyUserAuthentication()
    {
        // When using cookies, we just notify that the state might have changed
        // and GetAuthenticationStateAsync will be called again to fetch the new state.
        NotifyAuthenticationStateChanged(GetAuthenticationStateAsync());
    }

    public void NotifyUserLogout()
    {
        StopHeartbeatTimer();
        var anonymousUser = new ClaimsPrincipal(new ClaimsIdentity());
        var authState = Task.FromResult(new AuthenticationState(anonymousUser));
        NotifyAuthenticationStateChanged(authState);
    }

    public void Dispose()
    {
        StopHeartbeatTimer();
    }
}
