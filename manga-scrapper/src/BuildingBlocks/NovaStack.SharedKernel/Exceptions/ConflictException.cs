namespace NovaStack.SharedKernel.Exceptions;

/// <summary>Thrown when a resource conflict is detected (e.g., duplicate).</summary>
public class ConflictException : Exception
{
    public ConflictException(string message) : base(message) { }

    public ConflictException(string entityName, string field, object value)
        : base($"{entityName} with {field} '{value}' already exists.")
    {
    }
}
