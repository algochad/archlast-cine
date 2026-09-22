using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Hubs;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MangaScrapper.Core.Services;

/// <summary>
/// Streams chapter scraping progress and completion directly to the MangaScrapper.Api SignalR Hub over WebSocket,
/// removing the need for high-frequency RabbitMQ progress events.
/// </summary>
public sealed class WorkerSignalRBroadcaster : IScrapingProgressBroadcaster, IAsyncDisposable
{
    private readonly ScrapperSettings _settings;
    private readonly ILogger<WorkerSignalRBroadcaster> _logger;
    private readonly string? _hubUrl;
    private readonly SemaphoreSlim _connectLock = new(1, 1);
    private HubConnection? _hubConnection;
    private bool _isDisposed;

    public WorkerSignalRBroadcaster(
        IOptions<ScrapperSettings> settings,
        ILogger<WorkerSignalRBroadcaster> logger)
    {
        _settings = settings.Value;
        _logger = logger;

        var baseUrl = !string.IsNullOrWhiteSpace(_settings.ApiBaseUrl)
            ? _settings.ApiBaseUrl.TrimEnd('/')
            : "http://localhost:5234";

        _hubUrl = $"{baseUrl}/hubs/manga";
    }

    private async ValueTask<HubConnection?> EnsureConnectedAsync(CancellationToken ct)
    {
        if (_isDisposed || string.IsNullOrWhiteSpace(_hubUrl))
            return null;

        if (_hubConnection?.State == HubConnectionState.Connected)
            return _hubConnection;

        await _connectLock.WaitAsync(ct);
        try
        {
            if (_isDisposed) return null;
            if (_hubConnection?.State == HubConnectionState.Connected) return _hubConnection;

            if (_hubConnection == null)
            {
                _hubConnection = new HubConnectionBuilder()
                    .WithUrl(_hubUrl)
                    .WithAutomaticReconnect(new[]
                    {
                        TimeSpan.Zero,
                        TimeSpan.FromSeconds(2),
                        TimeSpan.FromSeconds(5),
                        TimeSpan.FromSeconds(10)
                    })
                    .Build();

                _hubConnection.Closed += error =>
                {
                    if (error != null)
                        _logger.LogWarning(error, "SignalR connection to {HubUrl} closed with error.", _hubUrl);
                    return Task.CompletedTask;
                };

                _hubConnection.Reconnecting += error =>
                {
                    _logger.LogInformation("SignalR connection to {HubUrl} reconnecting: {Error}", _hubUrl, error?.Message);
                    return Task.CompletedTask;
                };

                _hubConnection.Reconnected += connectionId =>
                {
                    _logger.LogInformation("SignalR connection to {HubUrl} restored. New connectionId: {ConnectionId}", _hubUrl, connectionId);
                    return Task.CompletedTask;
                };
            }

            if (_hubConnection.State == HubConnectionState.Disconnected)
            {
                _logger.LogInformation("Connecting to SignalR Hub at {HubUrl}...", _hubUrl);
                await _hubConnection.StartAsync(ct);
                _logger.LogInformation("Connected to SignalR Hub at {HubUrl}.", _hubUrl);
            }

            return _hubConnection;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not connect to SignalR Hub at {HubUrl}. Ephemeral progress notifications may be skipped.", _hubUrl);
            return null;
        }
        finally
        {
            _connectLock.Release();
        }
    }

    public async Task BroadcastProgressAsync(ChapterScrapingProgressPayload payload, CancellationToken ct = default)
    {
        try
        {
            var hub = await EnsureConnectedAsync(ct);
            if (hub is { State: HubConnectionState.Connected })
            {
                await hub.InvokeAsync("ReportScrapingProgress", payload, ct);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to send scraping progress to SignalR Hub: MangaId={MangaId}, ChapterId={ChapterId}", payload.MangaId, payload.ChapterId);
        }
    }

    public async Task BroadcastPagesScrapedAsync(ChapterPagesScrapedPayload payload, CancellationToken ct = default)
    {
        try
        {
            var hub = await EnsureConnectedAsync(ct);
            if (hub is { State: HubConnectionState.Connected })
            {
                await hub.InvokeAsync("ReportChapterPagesScraped", payload, ct);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to send chapter pages scraped to SignalR Hub: MangaId={MangaId}, ChapterId={ChapterId}", payload.MangaId, payload.ChapterId);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_isDisposed) return;
        _isDisposed = true;

        if (_hubConnection != null)
        {
            try
            {
                await _hubConnection.DisposeAsync();
            }
            catch
            {
                // Ignored during cleanup
            }
        }

        _connectLock.Dispose();
    }
}
