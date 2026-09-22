using Grpc.Net.Client;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Protos;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using Microsoft.ML.Tokenizers;
using System.Net.Http.Json;

namespace MangaScrapper.Core.Services;

/// <summary>
/// Embedding service supporting high-performance gRPC microservice communication
/// with fallback support for in-process ONNX runtime execution (e.g., onnx-community/Qwen3-Embedding-0.6B-ONNX).
/// </summary>
public sealed class OnnxEmbeddingService : IEmbeddingService, IDisposable
{
    private readonly EmbeddingConfig _config;
    private readonly ILogger<OnnxEmbeddingService> _logger;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly object _initLock = new();

    private GrpcChannel? _grpcChannel;
    private EmbeddingService.EmbeddingServiceClient? _grpcClient;
    private InferenceSession? _session;
    private Tokenizer? _tokenizer;
    private Dictionary<string, int>? _hfVocab;
    private bool _isInitialized;
    private bool _onnxAvailable;

    public OnnxEmbeddingService(
        IOptions<EmbeddingConfig> config,
        ILogger<OnnxEmbeddingService> logger,
        IHttpClientFactory httpClientFactory)
    {
        _config = config.Value;
        _logger = logger;
        _httpClientFactory = httpClientFactory;
    }

    public async Task<float[]?> GenerateEmbeddingAsync(string text, string mode = "passage", CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        // 1. Primary: Use high-performance gRPC embedding microservice if Host is configured
        if (!string.IsNullOrWhiteSpace(_config.Host))
        {
            var grpcResult = await GenerateGrpcEmbeddingAsync(text, mode, ct);
            if (grpcResult != null && grpcResult.Length > 0)
            {
                return grpcResult;
            }
        }

        // 2. Fallback: In-process ONNX embedding
        EnsureInitialized();

        if (_onnxAvailable && _session != null)
        {
            try
            {
                var formattedText = mode == "query" && !text.StartsWith("Instruct:")
                    ? $"Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: {text}"
                    : text;
                return ComputeOnnxEmbedding(formattedText);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to compute in-process ONNX embedding for text snippet.");
            }
        }

        return null;
    }

    private void EnsureInitialized()
    {
        if (_isInitialized) return;

        lock (_initLock)
        {
            if (_isInitialized) return;

            try
            {
                var modelPath = ResolvePath(_config.ModelPath);
                var tokenizerPath = ResolvePath(_config.TokenizerPath);

                if (File.Exists(modelPath))
                {
                    var sessionOptions = new SessionOptions
                    {
                        GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL,
                        ExecutionMode = ExecutionMode.ORT_SEQUENTIAL
                    };

                    _session = new InferenceSession(modelPath, sessionOptions);

                    if (File.Exists(tokenizerPath))
                    {
                        try
                        {
                            LoadTokenizerFromPath(tokenizerPath);
                            _logger.LogInformation("Loaded custom tokenizer from: {TokenizerPath}", tokenizerPath);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Failed to load custom tokenizer from {TokenizerPath}. Falling back to default TiktokenTokenizer.", tokenizerPath);
                            _tokenizer = TiktokenTokenizer.CreateForModel("gpt-4");
                        }
                    }
                    else
                    {
                        _logger.LogInformation("No custom tokenizer file found at {TokenizerPath}. Using default TiktokenTokenizer.", tokenizerPath);
                        try
                        {
                            _tokenizer = TiktokenTokenizer.CreateForModel("gpt-4");
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Failed to instantiate TiktokenTokenizer. Falling back to hash tokenization.");
                        }
                    }

                    _onnxAvailable = true;
                    _logger.LogInformation("In-process ONNX embedding session initialized successfully from {ModelPath}.", modelPath);
                }
                else
                {
                    _logger.LogWarning("ONNX model file not found at {ModelPath}. In-process ONNX embedding disabled.", modelPath);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to initialize ONNX embedding model.");
                _onnxAvailable = false;
            }
            finally
            {
                _isInitialized = true;
            }
        }
    }

    private void LoadTokenizerFromPath(string tokenizerPath)
    {
        if (tokenizerPath.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            var jsonContent = File.ReadAllText(tokenizerPath);
            using var doc = System.Text.Json.JsonDocument.Parse(jsonContent);
            if (doc.RootElement.TryGetProperty("model", out var modelElem) &&
                modelElem.TryGetProperty("vocab", out var vocabElem))
            {
                var vocab = new Dictionary<string, int>();
                foreach (var prop in vocabElem.EnumerateObject())
                {
                    vocab[prop.Name] = prop.Value.GetInt32();
                }
                _hfVocab = vocab;
                _logger.LogInformation("Successfully parsed {Count} vocabulary entries from HuggingFace tokenizer.json.", vocab.Count);
                return;
            }
        }

        // Fallback default TiktokenTokenizer
        _tokenizer = TiktokenTokenizer.CreateForModel("gpt-4");
    }

    private float[] ComputeOnnxEmbedding(string text)
    {
        IReadOnlyList<int> tokenIds;
        if (_hfVocab != null && _hfVocab.Count > 0)
        {
            tokenIds = EncodeWithHfVocab(text);
        }
        else if (_tokenizer != null)
        {
            tokenIds = _tokenizer.EncodeToIds(text);
        }
        else
        {
            // Basic fallback token ID mapping
            tokenIds = text.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Select(w => Math.Abs(w.GetHashCode()) % 30000 + 1)
                .Take(512)
                .ToList();
        }

        if (tokenIds.Count == 0)
        {
            tokenIds = new List<int> { 0 };
        }

        // Limit maximum sequence length
        if (tokenIds.Count > 512)
        {
            tokenIds = tokenIds.Take(512).ToList();
        }

        int seqLen = tokenIds.Count;
        var inputIdsTensor = new DenseTensor<long>(new[] { 1, seqLen });
        var attentionMaskTensor = new DenseTensor<long>(new[] { 1, seqLen });

        for (int i = 0; i < seqLen; i++)
        {
            inputIdsTensor[0, i] = tokenIds[i];
            attentionMaskTensor[0, i] = 1L;
        }

        var inputs = new List<NamedOnnxValue>();

        // Dynamically match model input metadata names and supply required tensors
        foreach (var kvp in _session!.InputMetadata)
        {
            var inputName = kvp.Key;
            var meta = kvp.Value;

            if (string.Equals(inputName, "input_ids", StringComparison.OrdinalIgnoreCase))
            {
                inputs.Add(NamedOnnxValue.CreateFromTensor(inputName, inputIdsTensor));
            }
            else if (string.Equals(inputName, "attention_mask", StringComparison.OrdinalIgnoreCase))
            {
                inputs.Add(NamedOnnxValue.CreateFromTensor(inputName, attentionMaskTensor));
            }
            else if (string.Equals(inputName, "token_type_ids", StringComparison.OrdinalIgnoreCase))
            {
                var tokenTypeTensor = new DenseTensor<long>(new[] { 1, seqLen });
                inputs.Add(NamedOnnxValue.CreateFromTensor(inputName, tokenTypeTensor));
            }
            else if (string.Equals(inputName, "position_ids", StringComparison.OrdinalIgnoreCase))
            {
                var positionIdsTensor = new DenseTensor<long>(new[] { 1, seqLen });
                for (int i = 0; i < seqLen; i++)
                {
                    positionIdsTensor[0, i] = i;
                }
                inputs.Add(NamedOnnxValue.CreateFromTensor(inputName, positionIdsTensor));
            }
            else if (inputName.StartsWith("past_key_values", StringComparison.OrdinalIgnoreCase))
            {
                // Supply 0-length sequence KV cache for initial embedding pass [batch_size, num_heads, 0, head_dim]
                int[] shape;
                if (meta.Dimensions != null && meta.Dimensions.Length == 4)
                {
                    int heads = meta.Dimensions[1] > 0 ? meta.Dimensions[1] : (meta.Dimensions[2] > 0 ? meta.Dimensions[2] : 8);
                    int headDim = meta.Dimensions[3] > 0 ? meta.Dimensions[3] : 128;
                    shape = new[] { 1, heads, 0, headDim };
                }
                else
                {
                    shape = new[] { 1, 8, 0, 128 };
                }

                if (meta.ElementType == typeof(Half))
                {
                    inputs.Add(NamedOnnxValue.CreateFromTensor(inputName, new DenseTensor<Half>(Array.Empty<Half>(), shape)));
                }
                else
                {
                    inputs.Add(NamedOnnxValue.CreateFromTensor(inputName, new DenseTensor<float>(Array.Empty<float>(), shape)));
                }
            }
        }

        // Fallback if metadata was empty
        if (inputs.Count == 0)
        {
            inputs.Add(NamedOnnxValue.CreateFromTensor("input_ids", inputIdsTensor));
            inputs.Add(NamedOnnxValue.CreateFromTensor("attention_mask", attentionMaskTensor));
        }

        using var results = _session.Run(inputs);
        var outputTensor = (results.FirstOrDefault(r => r.Name == "last_hidden_state" || r.Name == "sentence_embedding")
            ?? results.FirstOrDefault())?.AsTensor<float>();

        if (outputTensor == null)
        {
            throw new InvalidOperationException("ONNX model inference returned empty output.");
        }

        float[] embedding;
        int dims = outputTensor.Dimensions.Length;

        if (dims == 3) // [batch_size, seq_len, hidden_dim] -> Mean pooling
        {
            int hiddenDim = outputTensor.Dimensions[2];
            embedding = new float[hiddenDim];

            for (int i = 0; i < seqLen; i++)
            {
                for (int d = 0; d < hiddenDim; d++)
                {
                    embedding[d] += outputTensor[0, i, d];
                }
            }

            for (int d = 0; d < hiddenDim; d++)
            {
                embedding[d] /= seqLen;
            }
        }
        else if (dims == 2) // [batch_size, hidden_dim]
        {
            int hiddenDim = outputTensor.Dimensions[1];
            embedding = new float[hiddenDim];
            for (int d = 0; d < hiddenDim; d++)
            {
                embedding[d] = outputTensor[0, d];
            }
        }
        else
        {
            embedding = outputTensor.ToArray();
        }

        // L2 Normalization
        Normalize(embedding);

        return embedding;
    }

    private IReadOnlyList<int> EncodeWithHfVocab(string text)
    {
        var ids = new List<int>();
        var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        foreach (var word in words)
        {
            if (_hfVocab!.TryGetValue(word, out int id) ||
                _hfVocab!.TryGetValue(" " + word, out id) ||
                _hfVocab!.TryGetValue(word.ToLowerInvariant(), out id))
            {
                ids.Add(id);
            }
            else
            {
                foreach (var ch in word)
                {
                    if (_hfVocab!.TryGetValue(ch.ToString(), out int chId))
                    {
                        ids.Add(chId);
                    }
                    else
                    {
                        ids.Add(Math.Abs(ch.GetHashCode()) % 30000 + 1);
                    }
                }
            }
        }
        return ids;
    }

    private static void Normalize(float[] vector)
    {
        double sumSq = 0.0;
        for (int i = 0; i < vector.Length; i++)
        {
            sumSq += vector[i] * vector[i];
        }

        float norm = (float)Math.Sqrt(sumSq);
        if (norm > 1e-12f)
        {
            for (int i = 0; i < vector.Length; i++)
            {
                vector[i] /= norm;
            }
        }
    }

    private async Task<float[]?> GenerateGrpcEmbeddingAsync(string text, string mode, CancellationToken ct)
    {
        try
        {
            if (_grpcClient == null)
            {
                lock (_initLock)
                {
                    if (_grpcClient == null)
                    {
                        var host = _config.Host;
                        if (!host.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                            !host.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                        {
                            host = "http://" + host;
                        }

                        _grpcChannel = GrpcChannel.ForAddress(host);
                        _grpcClient = new EmbeddingService.EmbeddingServiceClient(_grpcChannel);
                    }
                }
            }

            var request = new EmbedRequest
            {
                Text = text,
                Mode = mode
            };

            var response = await _grpcClient.GenerateEmbeddingAsync(request, cancellationToken: ct);
            return response?.Dense?.ToArray();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch embedding from gRPC microservice at {Host}. Attempting in-process ONNX fallback.", _config.Host);
            return null;
        }
    }

    private static string ResolvePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return path;
        return Path.IsPathRooted(path) ? path : Path.Combine(Directory.GetCurrentDirectory(), path);
    }

    public void Dispose()
    {
        _session?.Dispose();
        _grpcChannel?.Dispose();
    }
}
