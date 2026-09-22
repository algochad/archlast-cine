namespace NovaStack.SharedKernel.Results;

/// <summary>Represents the type of error that occurred.</summary>
public enum ErrorType
{
    None,
    Failure,
    Validation,
    NotFound,
    Conflict,
    Unauthorized,
    Forbidden
}

/// <summary>Represents an error with a code, message, and type.</summary>
public record Error(string Code, string Message, ErrorType Type = ErrorType.Failure)
{
    /// <summary>Represents no error (success state).</summary>
    public static readonly Error None = new(string.Empty, string.Empty, ErrorType.None);

    /// <summary>Creates a not-found error.</summary>
    public static Error NotFound(string code, string message) =>
        new(code, message, ErrorType.NotFound);

    /// <summary>Creates a validation error.</summary>
    public static Error Validation(string code, string message) =>
        new(code, message, ErrorType.Validation);

    /// <summary>Creates a conflict error.</summary>
    public static Error Conflict(string code, string message) =>
        new(code, message, ErrorType.Conflict);

    /// <summary>Creates a generic failure error.</summary>
    public static Error Failure(string code, string message) =>
        new(code, message, ErrorType.Failure);

    /// <summary>Creates an unauthorized error.</summary>
    public static Error Unauthorized(string code = "Error.Unauthorized", string message = "Unauthorized access") =>
        new(code, message, ErrorType.Unauthorized);

    /// <summary>Creates a forbidden error.</summary>
    public static Error Forbidden(string code = "Error.Forbidden", string message = "Forbidden access") =>
        new(code, message, ErrorType.Forbidden);

    public override string ToString() => $"[{Type}] {Code}: {Message}";
}
