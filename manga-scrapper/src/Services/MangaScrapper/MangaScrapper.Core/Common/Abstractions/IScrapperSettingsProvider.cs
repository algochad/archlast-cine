namespace MangaScrapper.Core.Common.Abstractions;

/// <summary>
/// Provides storage-related settings to the Application layer without referencing Infrastructure config types.
/// </summary>
public interface IScrapperSettingsProvider
{
    /// <summary>Absolute path to the local image storage root directory.</summary>
    string ImageStoragePath { get; }
}
