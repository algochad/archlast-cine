namespace MangaScrapper.Core.Common.Abstractions;

/// <summary>
/// Manages active chapter scraping cancellation tokens for real-time task cancellation.
/// </summary>
public interface IScrapingCancellationManager
{
    /// <summary>
    /// Registers a new active chapter scraping task and returns a linked cancellation token source.
    /// </summary>
    CancellationTokenSource Register(Guid mangaId, Guid chapterId, CancellationToken parentToken);

    /// <summary>
    /// Unregisters a finished or aborted chapter scraping task.
    /// </summary>
    void Unregister(Guid chapterId);

    /// <summary>
    /// Cancels active chapter scraping tasks matching criteria (specific chapter, all chapters of manga, or all tasks).
    /// </summary>
    void Cancel(Guid? mangaId, Guid? chapterId, bool cancelAll = false);
}
