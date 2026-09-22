namespace MangaScrapper.Core.Services;

public interface IEmbeddingService
{
    Task<float[]?> GenerateEmbeddingAsync(string text, string mode = "passage", CancellationToken ct = default);
}
