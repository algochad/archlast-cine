using System.Text.RegularExpressions;
using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Services;
using MangaScrapper.Core.Utils;
using MangaScrapper.Core.ValueObjects;
using Mapster;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;
using SkiaSharp;

namespace MangaScrapper.Core.Features.Mangas.UpdateThumbnail;

public record UpdateThumbnailRequest(string ImageUrl);

public record UpdateThumbnailCommand(
    Guid Id,
    string ImageUrl) : ICommand<MangaSummaryResponse>;

public record UploadThumbnailCommand(
    Guid Id,
    byte[] ImageBytes,
    string ContentType,
    string FileName) : ICommand<MangaSummaryResponse>;

internal static class ThumbnailProcessor
{
    public static async Task<(string relativePath, long size)> ProcessAndSaveThumbnailAsync(
        byte[] imageBytes,
        string mangaTitle,
        string storageRootPath,
        string? sourceUrlOrFileName = null,
        ILogger? logger = null,
        CancellationToken ct = default)
    {
        var cleanTitle = ThumbnailHelper.GetCleanTitle(mangaTitle);
        var subDir = Path.Combine(storageRootPath, cleanTitle);
        Directory.CreateDirectory(subDir);

        var isAvif = ImageDimensionReader.IsAvif(imageBytes) || (!string.IsNullOrEmpty(sourceUrlOrFileName) && ThumbnailHelper.IsAvifUrl(sourceUrlOrFileName));
        var isWebp = ImageDimensionReader.IsWebp(imageBytes) || (!string.IsNullOrEmpty(sourceUrlOrFileName) && ThumbnailHelper.IsWebpUrl(sourceUrlOrFileName));

        if (isAvif)
        {
            var fileName = "thumbnail.avif";
            var filePath = Path.Combine(subDir, fileName);
            var relativePath = $"{cleanTitle}/{fileName}".Replace("\\", "/");
            await File.WriteAllBytesAsync(filePath, imageBytes, ct);
            return (relativePath, new FileInfo(filePath).Length);
        }

        if (isWebp)
        {
            var fileName = "thumbnail.webp";
            var filePath = Path.Combine(subDir, fileName);
            var relativePath = $"{cleanTitle}/{fileName}".Replace("\\", "/");
            await File.WriteAllBytesAsync(filePath, imageBytes, ct);
            return (relativePath, new FileInfo(filePath).Length);
        }

        var webpFileName = "thumbnail.webp";
        var webpFilePath = Path.Combine(subDir, webpFileName);
        var webpRelativePath = $"{cleanTitle}/{webpFileName}".Replace("\\", "/");

        bool saved = false;
        try
        {
            using var imageData = SKData.CreateCopy(imageBytes);
            using var skImage = SKImage.FromEncodedData(imageData);
            if (skImage != null)
            {
                using var encoded = skImage.Encode(SKEncodedImageFormat.Webp, 90);
                if (encoded != null)
                {
                    await using var outStream = File.Create(webpFilePath);
                    encoded.SaveTo(outStream);
                    saved = true;
                }
            }

            if (!saved)
            {
                using var bmpStream = new MemoryStream(imageBytes, writable: false);
                using var bitmap = SKBitmap.Decode(bmpStream);
                if (bitmap != null)
                {
                    using var encodedBmp = bitmap.Encode(SKEncodedImageFormat.Webp, 90);
                    if (encodedBmp != null)
                    {
                        await using var outStream = File.Create(webpFilePath);
                        encodedBmp.SaveTo(outStream);
                        saved = true;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "SkiaSharp failed to convert thumbnail for {Title}. Saving raw bytes.", mangaTitle);
        }

        if (!saved)
        {
            await File.WriteAllBytesAsync(webpFilePath, imageBytes, ct);
        }

        return (webpRelativePath, new FileInfo(webpFilePath).Length);
    }
}

public sealed class UpdateThumbnailCommandHandler(
    IMangaRepository mangaRepository,
    IMangaExternalRepository mangaExternalRepository,
    IScrapperSettingsProvider settingsProvider,
    IHttpClientFactory httpClientFactory,
    FlareSolverrService flareSolverrService,
    ILogger<UpdateThumbnailCommandHandler> logger)
    : ICommandHandler<UpdateThumbnailCommand, MangaSummaryResponse>
{
    private const string DefaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    public async Task<Result<MangaSummaryResponse>> Handle(UpdateThumbnailCommand command, CancellationToken ct)
    {
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(command.Id), ct);
        if (manga is null)
            return Error.NotFound("Manga.NotFound", $"Manga with Id '{command.Id}' was not found.");

        var imageUrl = ThumbnailHelper.RemoveResizeParams(command.ImageUrl?.Trim() ?? string.Empty);
        if (string.IsNullOrWhiteSpace(imageUrl) || !Uri.TryCreate(imageUrl, UriKind.Absolute, out _))
            return Error.Validation("Thumbnail.InvalidUrl", "A valid absolute image URL must be provided.");

        byte[] imageBytes;
        try
        {
            var httpClient = httpClientFactory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, imageUrl);
            request.Headers.TryAddWithoutValidation("User-Agent", DefaultUserAgent);
            request.Headers.TryAddWithoutValidation("Accept", "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");

            var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode && flareSolverrService is { IsEnabled: true })
            {
                await flareSolverrService.EnsureSessionAsync(imageUrl, ct);
                if (Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri) &&
                    flareSolverrService.TryGetSession(uri.Host, out var userAgent, out var cookieHeader))
                {
                    using var req2 = new HttpRequestMessage(HttpMethod.Get, imageUrl);
                    req2.Headers.TryAddWithoutValidation("User-Agent", !string.IsNullOrEmpty(userAgent) ? userAgent : DefaultUserAgent);
                    req2.Headers.TryAddWithoutValidation("Accept", "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
                    if (!string.IsNullOrEmpty(cookieHeader)) req2.Headers.TryAddWithoutValidation("Cookie", cookieHeader);
                    response = await httpClient.SendAsync(req2, HttpCompletionOption.ResponseHeadersRead, ct);
                }
            }

            response.EnsureSuccessStatusCode();
            imageBytes = await response.Content.ReadAsByteArrayAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to download image from {Url} for Manga {Title}", imageUrl, manga.Title);
            return Error.Failure("Thumbnail.DownloadFailed", $"Failed to download thumbnail from URL: {ex.Message}");
        }

        if (imageBytes.Length == 0)
            return Error.Failure("Thumbnail.Empty", "The downloaded thumbnail image was empty.");

        var (relativePath, size) = await ThumbnailProcessor.ProcessAndSaveThumbnailAsync(
            imageBytes,
            manga.Title,
            settingsProvider.ImageStoragePath,
            imageUrl,
            logger,
            ct);

        manga.UpdateThumbnail(imageUrl, relativePath, size);
        await mangaRepository.UpdateAsync(manga, ct);

        await mangaExternalRepository.IndexMangaAsync(manga, ct);
        await mangaExternalRepository.UpsertMangaAsync(manga, ct);

        return manga.Adapt<MangaSummaryResponse>();
    }
}

public sealed class UploadThumbnailCommandHandler(
    IMangaRepository mangaRepository,
    IMangaExternalRepository mangaExternalRepository,
    IScrapperSettingsProvider settingsProvider,
    ILogger<UploadThumbnailCommandHandler> logger)
    : ICommandHandler<UploadThumbnailCommand, MangaSummaryResponse>
{
    public async Task<Result<MangaSummaryResponse>> Handle(UploadThumbnailCommand command, CancellationToken ct)
    {
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(command.Id), ct);
        if (manga is null)
            return Error.NotFound("Manga.NotFound", $"Manga with Id '{command.Id}' was not found.");

        if (command.ImageBytes is null || command.ImageBytes.Length == 0)
            return Error.Validation("Thumbnail.EmptyFile", "Uploaded file is empty.");

        var (relativePath, size) = await ThumbnailProcessor.ProcessAndSaveThumbnailAsync(
            command.ImageBytes,
            manga.Title,
            settingsProvider.ImageStoragePath,
            command.FileName,
            logger,
            ct);

        manga.UpdateLocalImage(relativePath, size);
        await mangaRepository.UpdateAsync(manga, ct);

        await mangaExternalRepository.IndexMangaAsync(manga, ct);
        await mangaExternalRepository.UpsertMangaAsync(manga, ct);

        return manga.Adapt<MangaSummaryResponse>();
    }
}

public sealed class UpdateThumbnailEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapPatch("/api/v1/manga/{id:guid}/thumbnail", HandleUpdateThumbnailAsync)
            .WithName("UpdateMangaThumbnail")
            .RequireAuthorization(User.UserRoles.SuperUser)
            .RequireRateLimiting(RateLimitPolicies.Default)
            .WithSummary("Update manga thumbnail from a remote URL")
            .WithTags("Manga")
            .Produces<ApiResponse<MangaSummaryResponse>>();

        app.MapPost("/api/v1/manga/{id:guid}/thumbnail/upload", HandleUploadThumbnailAsync)
            .WithName("UploadMangaThumbnail")
            .RequireAuthorization(User.UserRoles.SuperUser)
            .RequireRateLimiting(RateLimitPolicies.Default)
            .WithSummary("Upload manga thumbnail file directly")
            .WithTags("Manga")
            .DisableAntiforgery()
            .Produces<ApiResponse<MangaSummaryResponse>>();
    }

    private static async Task<IResult> HandleUpdateThumbnailAsync(
        Guid id,
        UpdateThumbnailRequest request,
        ISender sender,
        CancellationToken ct)
    {
        var result = await sender.Send(new UpdateThumbnailCommand(id, request.ImageUrl), ct);
        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value, "Thumbnail updated successfully"))
            : result.Error.ToHttpResult();
    }

    private static async Task<IResult> HandleUploadThumbnailAsync(
        Guid id,
        IFormFile file,
        ISender sender,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return Results.BadRequest(ApiResponse.Fail("No file was uploaded or file is empty."));

        using var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream, ct);
        var bytes = memoryStream.ToArray();

        var result = await sender.Send(new UploadThumbnailCommand(id, bytes, file.ContentType, file.FileName), ct);
        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok(result.Value, "Thumbnail uploaded and updated successfully"))
            : result.Error.ToHttpResult();
    }
}
