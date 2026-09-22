using System.Text.Json;
using System.Text.Json.Serialization;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Configuration;

namespace MangaScrapper.Core.Services;

public class DiscordWebhookService
{
    private readonly HttpClient _httpClient;
    private readonly DiscordWebhookSettings _settings;
    private readonly DomainSettings _domainSettings;
    private readonly ILogger<DiscordWebhookService> _logger;

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public DiscordWebhookService(
        HttpClient httpClient,
        IOptions<DiscordWebhookSettings> settings,
        ILogger<DiscordWebhookService> logger,
        IOptions<DomainSettings> domainSettings)
    {
        _httpClient = httpClient;
        _settings = settings.Value;
        _logger = logger;
        _domainSettings = domainSettings.Value;
    }

    public async Task SendNewMangaNotificationAsync(Manga manga, List<Chapter> chapters, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_settings.WebhookUrl))
        {
            _logger.LogWarning("Discord Webhook URL is not configured. Skipping notification.");
            return;
        }

        try
        {
            var truncatedDescription = manga.Description;
            if (!string.IsNullOrEmpty(truncatedDescription) && truncatedDescription.Length > 1000)
            {
                truncatedDescription = truncatedDescription[..997] + "...";
            }

            var initialChaptersText = chapters.Any()
                ? string.Join(", ", chapters.OrderByDescending(c => c.Number).Take(5).Select(c => $"Ch. {c.Number}"))
                : "No chapters loaded yet.";

            var encodedPath = string.Join('/',
                (manga.LocalImageUrl ?? string.Empty)
                    .Split('/')
                    .Select(Uri.EscapeDataString));

            var mangaThumb = string.IsNullOrWhiteSpace(manga.LocalImageUrl) ? null : new { url = $"{_domainSettings.DomainUrl}/images/{encodedPath}" };

            var embed = new
            {
                title = $"🆕 New {manga.Type} Added: {manga.Title}",
                description = truncatedDescription ?? "No description available.",
                url = $"{_domainSettings.DomainUrl}/manga/{manga.Id.Value}",
                color = 3066993, // Green (Emerald)
                thumbnail = mangaThumb,
                fields = new[]
                {
                    new { name = "Author", value = string.IsNullOrWhiteSpace(manga.Author) ? "Unknown" : manga.Author, inline = true },
                    new { name = "Type", value = string.IsNullOrWhiteSpace(manga.Type) ? "Unknown" : manga.Type, inline = true },
                    new { name = "Rating", value = manga.Rating?.ToString("F1") ?? "N/A", inline = true },
                    new { name = "Genres", value = manga.Genres != null && manga.Genres.Any() ? string.Join(", ", manga.Genres) : "N/A", inline = false },
                    new { name = "Initial Chapters", value = initialChaptersText, inline = false }
                },
                footer = new { text = "MangaScrapper Notification" },
                timestamp = DateTime.UtcNow.ToString("o")
            };

            var payload = new { embeds = new[] { embed } };

            var response = await _httpClient.PostAsJsonAsync(_settings.WebhookUrl, payload, SerializerOptions, ct);
            if (!response.IsSuccessStatusCode)
            {
                var responseContent = await response.Content.ReadAsStringAsync(ct);
                _logger.LogError("Failed to send Discord notification for new manga. Status: {StatusCode}, Content: {Content}", response.StatusCode, responseContent);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception occurred while sending Discord notification for new manga: {MangaTitle}", manga.Title);
        }
    }

    public async Task SendNewChaptersNotificationAsync(Manga manga, List<Chapter> newChapters, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_settings.WebhookUrl))
        {
            _logger.LogWarning("Discord Webhook URL is not configured. Skipping notification.");
            return;
        }

        if (newChapters == null || !newChapters.Any()) return;

        try
        {
            var chaptersListText = string.Join("\n", newChapters.OrderByDescending(c => c.Number).Take(10).Select(c => $"• Ch. {c.Number} (Language: {c.Language})"));
            if (newChapters.Count > 10)
            {
                chaptersListText += $"\n*and {newChapters.Count - 10} more chapters...*";
            }

            var encodedPath = string.Join('/',
                (manga.LocalImageUrl ?? string.Empty)
                    .Split('/')
                    .Select(Uri.EscapeDataString));

            var mangaThumb = string.IsNullOrWhiteSpace(manga.LocalImageUrl) ? null : new { url = $"{_domainSettings.DomainUrl}/images/{encodedPath}" };

            var embed = new
            {
                title = $"⚡ New Chapters Available: {manga.Title}",
                description = $"New chapters have been scraped/updated for **{manga.Title}**.",
                url = $"{_domainSettings.DomainUrl}/manga/{manga.Id.Value}",
                color = 15105570, // Orange
                thumbnail = mangaThumb,
                fields = new[]
                {
                    new { name = "New Chapters", value = chaptersListText, inline = false }
                },
                footer = new { text = "MangaScrapper Notification" },
                timestamp = DateTime.UtcNow.ToString("o")
            };

            var payload = new { embeds = new[] { embed } };

            var response = await _httpClient.PostAsJsonAsync(_settings.WebhookUrl, payload, SerializerOptions, ct);
            if (!response.IsSuccessStatusCode)
            {
                var responseContent = await response.Content.ReadAsStringAsync(ct);
                _logger.LogError("Failed to send Discord notification for new chapters. Status: {StatusCode}, Content: {Content}", response.StatusCode, responseContent);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception occurred while sending Discord notification for new chapters: {MangaTitle}", manga.Title);
        }
    }
}
