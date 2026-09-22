namespace NovaStack.SharedKernel.Exceptions;

/// <summary>Thrown when a validation rule is violated.</summary>
public class ValidationException : Exception
{
    public IDictionary<string, string[]> Errors { get; }

    public ValidationException(IDictionary<string, string[]> errors)
        : base("One or more validation errors occurred.")
    {
        Errors = errors;
    }

    public ValidationException(string field, string message)
        : this(new Dictionary<string, string[]> { { field, [message] } })
    {
    }
}
