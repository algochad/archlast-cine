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

namespace MangaScrapper.Core.Features.Mangas.UpdateManga;

public record UpdateMangaCommand(
    Guid Id,
    int MalId,
    int? AnilistId,
    long? MangaUpdateId,
    string Author,
    string Type,
    List<string>? Synonyms,
    List<string> Genres,
    List<string> Categories,
    string? Description,
    double? Rating,
    DateTime? ReleaseDate,
    bool? Nsfw,
    string? Status,
    int TotalView,
    int Popularity,
    int Members,
    string? Title = null) : ICommand<MangaSummaryResponse>;

public sealed class UpdateMangaCommandHandler(
    IMangaRepository mangaRepository,
    IMangaExternalRepository mangaExternalRepository,
    IScrapperSettingsProvider settingsProvider,
    IUserLibraryRepository userLibraryRepository,
    ILogger<UpdateMangaCommandHandler> logger)
    : ICommandHandler<UpdateMangaCommand, MangaSummaryResponse>
{
    public async Task<Result<MangaSummaryResponse>> Handle(UpdateMangaCommand command, CancellationToken ct)
    {
        var manga = await mangaRepository.GetByIdAsync(MangaId.From(command.Id), ct);

        if (manga is null)
            return Error.NotFound("Manga.NotFound", $"Manga with Id '{command.Id}' was not found.");

        var synonyms = command.Synonyms != null ? new List<string>(command.Synonyms) : new List<string>(manga.Synonyms ?? []);

        if (!string.IsNullOrWhiteSpace(command.Title) && command.Title != manga.Title)
        {
            var oldTitle = manga.Title;
            var oldCleanTitle = ThumbnailHelper.GetCleanTitle(oldTitle);
            var newCleanTitle = ThumbnailHelper.GetCleanTitle(command.Title);

            if (!synonyms.Any(s => string.Equals(s, oldTitle, StringComparison.OrdinalIgnoreCase)))
            {
                synonyms.Add(oldTitle);
            }

            if (!string.Equals(oldCleanTitle, newCleanTitle, StringComparison.Ordinal))
            {
                var storagePath = settingsProvider.ImageStoragePath;
                var oldDir = Path.Combine(storagePath, oldCleanTitle);
                var newDir = Path.Combine(storagePath, newCleanTitle);

                if (Directory.Exists(oldDir))
                {
                    // Handle case-sensitivity rename on case-insensitive filesystems (e.g. Windows)
                    if (string.Equals(oldCleanTitle, newCleanTitle, StringComparison.OrdinalIgnoreCase))
                    {
                        var tempDir = Path.Combine(storagePath, $"_temp_{Guid.NewGuid():N}");
                        try
                        {
                            Directory.Move(oldDir, tempDir);
                            Directory.Move(tempDir, newDir);
                        }
                        catch (Exception ex)
                        {
                            logger.LogError(ex, "Failed case-sensitive rename from {OldDir} to {NewDir}", oldDir, newDir);
                            return Error.Failure("Manga.DirectoryMoveFailed", $"Failed to rename storage directory: {ex.Message}");
                        }
                    }
                    else
                    {
                        if (Directory.Exists(newDir))
                        {
                            logger.LogWarning("Target directory {NewDir} already exists when renaming {OldDir}", newDir, oldDir);
                            return Error.Conflict("Manga.DirectoryConflict", $"Target storage directory '{newCleanTitle}' already exists.");
                        }

                        try
                        {
                            Directory.Move(oldDir, newDir);
                        }
                        catch (Exception ex)
                        {
                            logger.LogError(ex, "Failed to move storage directory from {OldDir} to {NewDir}", oldDir, newDir);
                            return Error.Failure("Manga.DirectoryMoveFailed", $"Failed to move storage directory: {ex.Message}");
                        }
                    }
                }

                manga.UpdateTitleAndFileRoutes(command.Title, newCleanTitle, oldCleanTitle);
            }
            else
            {
                manga.UpdateTitleOnly(command.Title);
            }

            await userLibraryRepository.UpdateMangaInfoAsync(manga.Id.Value, command.Title, manga.LocalImageUrl, ct);
        }

        manga.UpdateMetadata(
            command.MalId,
            command.AnilistId,
            command.MangaUpdateId,
            command.Author,
            command.Type,
            synonyms,
            command.Genres,
            command.Categories,
            command.Description,
            command.Rating,
            command.Popularity,
            command.Members,
            command.Nsfw,
            command.Status,
            command.ReleaseDate,
            command.TotalView);

        await mangaRepository.UpdateAsync(manga, ct);

        // Update Meilisearch,Qdrant via external repository
        await mangaExternalRepository.IndexMangaAsync(manga, ct);
        await mangaExternalRepository.UpsertMangaAsync(manga, ct);

        return manga.Adapt<MangaSummaryResponse>();
    }
}

public sealed class UpdateMangaEndpoint : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        app.MapPatch("/api/v1/manga/{id:guid}", HandleUpdateAsync)
            .WithName("UpdateManga")
            .RequireAuthorization(User.UserRoles.SuperUser)
            .RequireRateLimiting(RateLimitPolicies.Default)
            .WithSummary("Update manga details")
            .WithTags("Manga")
            .Produces<ApiResponse<object>>();
    }

    private static async Task<IResult> HandleUpdateAsync(
        Guid id,
        UpdateMangaCommand request,
        ISender sender,
        CancellationToken ct)
    {
        // Ensure the ID from the route matches the body
        if (id != request.Id)
        {
            request = request with { Id = id };
        }

        var result = await sender.Send(request, ct);
        return result.IsSuccess
            ? Results.Ok(ApiResponse.Ok<object?>(null, "Manga updated successfully"))
            : result.Error.ToHttpResult();
    }
}
