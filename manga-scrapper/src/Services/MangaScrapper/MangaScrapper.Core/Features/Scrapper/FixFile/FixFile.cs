using MangaScrapper.Core.Aggregates;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Repositories;
using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using NovaStack.Contracts.Responses;
using NovaStack.SharedKernel.Results;

namespace MangaScrapper.Core.Features.Scrapper.FixFile;

public record FixFileCommand : ICommand<FixFileResultResponse>;

internal sealed class FixFileCommandHandler(
    IMangaRepository repo,
    IScrapperSettingsProvider settings)
    : ICommandHandler<FixFileCommand, FixFileResultResponse>
{
    private readonly string _imageStoragePath = settings.ImageStoragePath;

    public async Task<Result<FixFileResultResponse>> Handle(FixFileCommand command, CancellationToken ct)
    {
        var mangas = await repo.GetAllAsync(ct);
        if (mangas is null || mangas.Count == 0)
        {
            return new FixFileResultResponse { Message = "No manga found to fix.", TotalFixed = 0 };
        }

        int totalFixed = 0;
        foreach (var manga in mangas)
        {
            bool thumbnailFixed = FixThumbnailPath(manga);
            int pagesFixed = FixChapterPages(manga);

            if (thumbnailFixed || pagesFixed > 0)
            {
                totalFixed += pagesFixed;
                await repo.UpdateAsync(manga, ct);
            }
        }

        return new FixFileResultResponse { Message = "File fixing complete", TotalFixed = totalFixed };
    }

    private bool FixThumbnailPath(Manga manga)
    {
        if (string.IsNullOrEmpty(manga.LocalImageUrl) || !manga.LocalImageUrl.StartsWith('/'))
            return false;

        var originalPath = manga.LocalImageUrl;
        var trimmedPath = originalPath.TrimStart('/');

        var oldFullPath = Path.Combine(_imageStoragePath, originalPath.Replace('/', Path.DirectorySeparatorChar));
        var newFullPath = Path.Combine(_imageStoragePath, trimmedPath.Replace('/', Path.DirectorySeparatorChar));

        if (File.Exists(oldFullPath) && !File.Exists(newFullPath))
        {
            File.Move(oldFullPath, newFullPath);
        }

        manga.UpdateLocalImage(trimmedPath, manga.ThumbnailSize);
        return true;
    }

    private int FixChapterPages(Manga manga)
    {
        int totalFixed = 0;
        foreach (var chapter in manga.Chapters)
        {
            for (int i = 0; i < chapter.Pages.Count; i++)
            {
                if (FixPage(chapter.Pages[i], i + 1))
                    totalFixed++;
            }
        }
        return totalFixed;
    }

    private bool FixPage(Page page, int index)
    {
        if (string.IsNullOrEmpty(page.LocalImageUrl)) return false;

        bool needsUpdate = false;
        var localPath = page.LocalImageUrl;
        if (localPath.StartsWith('/'))
        {
            localPath = localPath.TrimStart('/');
            needsUpdate = true;
        }

        var ext = Path.GetExtension(localPath);
        if (string.IsNullOrEmpty(ext)) ext = ".webp";
        var expectedFileName = $"{index}{ext}";
        var currentFileName = Path.GetFileName(localPath);
        var currentRelativeDir = Path.GetDirectoryName(localPath);

        if (string.IsNullOrEmpty(currentRelativeDir)) return needsUpdate;

        if (currentFileName != expectedFileName)
        {
            var newRelativePath = Path.Combine(currentRelativeDir, expectedFileName).Replace("\\", "/");
            var oldFullPath = Path.Combine(_imageStoragePath, localPath.Replace('/', Path.DirectorySeparatorChar));
            var newFullPath = Path.Combine(_imageStoragePath, newRelativePath.Replace('/', Path.DirectorySeparatorChar));

            try
            {
                if (File.Exists(oldFullPath))
                {
                    if (!File.Exists(newFullPath))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(newFullPath)!);
                        File.Move(oldFullPath, newFullPath);
                    }
                    page.UpdateLocalImage(newRelativePath, page.Size);
                    return true;
                }

                if (File.Exists(newFullPath))
                {
                    page.UpdateLocalImage(newRelativePath, page.Size);
                    return true;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error fixing file {oldFullPath}: {ex.Message}");
            }
        }
        else if (needsUpdate)
        {
            page.UpdateLocalImage(localPath, page.Size);
        }

        return needsUpdate;
    }
}

public sealed class FixFileEndpoints : IEndpointDefinition
{
    public void DefineEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/scrapper")
            .WithTags("Scrapper")
            .RequireRateLimiting(RateLimitPolicies.Scraping);

        group.MapGet("/fixfile", async (ISender sender, CancellationToken ct) =>
        {
            var res = await sender.Send(new FixFileCommand(), ct);
            return res.IsSuccess ? Results.Ok(ApiResponse.Ok(res.Value)) : res.Error.ToHttpResult();
        }).WithName("FixFilePaths");
    }
}
