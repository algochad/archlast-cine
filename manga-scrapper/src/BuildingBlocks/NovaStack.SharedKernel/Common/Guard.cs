using System.Diagnostics.CodeAnalysis;

namespace NovaStack.SharedKernel.Common;

/// <summary>Guard clause helper for defensive programming.</summary>
public static class Guard
{
    public static T NotNull<T>(
        [NotNull] T? value,
        string paramName,
        string? message = null)
    {
        if (value is null)
            throw new ArgumentNullException(paramName, message ?? $"{paramName} cannot be null.");
        return value;
    }

    public static string NotNullOrWhiteSpace(
        [NotNull] string? value,
        string paramName,
        string? message = null)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new ArgumentException(message ?? $"{paramName} cannot be null or whitespace.", paramName);
        return value;
    }

    public static T NotDefault<T>(T value, string paramName, string? message = null)
        where T : struct
    {
        if (value.Equals(default(T)))
            throw new ArgumentException(message ?? $"{paramName} cannot be the default value.", paramName);
        return value;
    }

    public static int Positive(int value, string paramName, string? message = null)
    {
        if (value <= 0)
            throw new ArgumentOutOfRangeException(paramName, message ?? $"{paramName} must be positive.");
        return value;
    }

    public static decimal NonNegative(decimal value, string paramName, string? message = null)
    {
        if (value < 0)
            throw new ArgumentOutOfRangeException(paramName, message ?? $"{paramName} cannot be negative.");
        return value;
    }

    public static IEnumerable<T> NotEmpty<T>(
        [NotNull] IEnumerable<T>? value,
        string paramName,
        string? message = null)
    {
        if (value is null || !value.Any())
            throw new ArgumentException(message ?? $"{paramName} cannot be null or empty.", paramName);
        return value;
    }
}
