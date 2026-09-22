using System.Globalization;
using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using MangaScrapper.Core.Repositories;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace MangaScrapper.Core.Services;

public class FcmNotificationService(
    IServiceScopeFactory scopeFactory,
    ILogger<FcmNotificationService> logger)
{
    /// <summary>
    /// Sends a real-time FCM notification to all users who have bookmarked this manga in their library,
    /// and also publishes to the topic $"manga_{mangaId:N}" for topic-based Flutter subscriptions.
    /// </summary>
    public async Task SendNewChapterNotificationToUserLibraryAsync(
        Guid mangaId,
        string mangaTitle,
        double chapterNumber,
        string? imageUrl = null,
        CancellationToken ct = default)
    {
        if (FirebaseApp.DefaultInstance == null)
        {
            logger.LogDebug("FirebaseApp is not initialized. Skipping FCM notification for Manga {MangaId}.", mangaId);
            return;
        }

        try
        {
            var chapterStr = chapterNumber.ToString("0.##", CultureInfo.InvariantCulture);
            var notificationTitle = $"New Chapter: {mangaTitle}";
            var notificationBody = $"Chapter {chapterStr} is now available to read!";

            var notification = new Notification
            {
                Title = notificationTitle,
                Body = notificationBody,
                ImageUrl = imageUrl
            };

            var dataPayload = new Dictionary<string, string>
            {
                ["type"] = "new_chapter",
                ["mangaId"] = mangaId.ToString(),
                ["mangaTitle"] = mangaTitle,
                ["chapterNumber"] = chapterStr,
                ["imageUrl"] = imageUrl ?? string.Empty,
                ["click_action"] = "FLUTTER_NOTIFICATION_CLICK"
            };

            // 1. Publish to Topic for Flutter client topic subscribers (e.g. subscribeToTopic("manga_<guid>"))
            try
            {
                var topicMessage = new Message
                {
                    Topic = $"manga_{mangaId:N}",
                    Notification = notification,
                    Data = dataPayload,
                    Android = new AndroidConfig
                    {
                        Priority = Priority.High,
                        Notification = new AndroidNotification
                        {
                            Sound = "default",
                            ClickAction = "FLUTTER_NOTIFICATION_CLICK"
                        }
                    },
                    Apns = new ApnsConfig
                    {
                        Aps = new Aps
                        {
                            Sound = "default",
                            Badge = 1
                        }
                    }
                };

                await FirebaseMessaging.DefaultInstance.SendAsync(topicMessage, ct);
                logger.LogInformation("FCM topic notification sent for Topic 'manga_{MangaId:N}', Manga: {MangaTitle}, Chapter: {Chapter}",
                    mangaId, mangaTitle, chapterStr);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to send FCM topic message for manga {MangaId}", mangaId);
            }

            // 2. Multicast to registered user devices who have saved this manga in UserLibrary
            using var scope = scopeFactory.CreateScope();
            var userLibraryRepo = scope.ServiceProvider.GetRequiredService<IUserLibraryRepository>();
            var userRepo = scope.ServiceProvider.GetRequiredService<IUserRepository>();

            var userIds = await userLibraryRepo.GetUserIdsByMangaIdAsync(mangaId, ct);
            if (userIds.Count == 0)
            {
                logger.LogDebug("No users found with manga {MangaId} in their library.", mangaId);
                return;
            }

            var fcmTokens = await userRepo.GetFcmTokensByUserIdsAsync(userIds, ct);
            if (fcmTokens.Count == 0)
            {
                logger.LogDebug("No active FCM tokens found for users following manga {MangaId}.", mangaId);
                return;
            }

            // Batch multicast in chunks of 500 (FCM limit per multicast)
            foreach (var batch in fcmTokens.Distinct().Chunk(500))
            {
                var multicast = new MulticastMessage
                {
                    Tokens = batch.ToList(),
                    Notification = notification,
                    Data = dataPayload,
                    Android = new AndroidConfig
                    {
                        Priority = Priority.High,
                        Notification = new AndroidNotification
                        {
                            Sound = "default",
                            ClickAction = "FLUTTER_NOTIFICATION_CLICK"
                        }
                    },
                    Apns = new ApnsConfig
                    {
                        Aps = new Aps
                        {
                            Sound = "default",
                            Badge = 1
                        }
                    }
                };

                var response = await FirebaseMessaging.DefaultInstance.SendEachForMulticastAsync(multicast, ct);
                logger.LogInformation("FCM Multicast sent for Manga: {MangaTitle}, Chapter: {Chapter}. Success: {SuccessCount}, Failure: {FailureCount}",
                    mangaTitle, chapterStr, response.SuccessCount, response.FailureCount);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error while dispatching FCM new chapter notification for Manga {MangaId} ({MangaTitle})",
                mangaId, mangaTitle);
        }
    }
}
