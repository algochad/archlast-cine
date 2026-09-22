using NovaStack.SharedKernel.Common;

namespace NovaStack.Contracts.Responses;

/// <summary>Unified API response envelope.</summary>
public sealed class ApiResponse<T>
{
    public bool Success { get; init; }
    public T? Data { get; init; }
    public string? Message { get; init; }
    public IEnumerable<string>? Errors { get; init; }
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;

    public static ApiResponse<T> Ok(T data, string? message = null) =>
        new() { Success = true, Data = data, Message = message };

    public static ApiResponse<T> Fail(string message, IEnumerable<string>? errors = null) =>
        new() { Success = false, Message = message, Errors = errors };
}

/// <summary>Non-generic success/fail response.</summary>
public static class ApiResponse
{
    public static ApiResponse<T> Ok<T>(T data, string? message = null) =>
        ApiResponse<T>.Ok(data, message);

    public static ApiResponse<object?> Fail(string message, IEnumerable<string>? errors = null) =>
        ApiResponse<object?>.Fail(message, errors);
}
