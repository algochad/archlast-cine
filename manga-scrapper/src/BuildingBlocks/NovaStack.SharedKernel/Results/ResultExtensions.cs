namespace NovaStack.SharedKernel.Results;

/// <summary>Extension methods for ergonomic <see cref="Result"/> chaining.</summary>
public static class ResultExtensions
{
    /// <summary>Chains a result with another operation if successful.</summary>
    public static Result<TOut> Bind<TIn, TOut>(
        this Result<TIn> result,
        Func<TIn, Result<TOut>> func) =>
        result.IsSuccess ? func(result.Value) : Result.Failure<TOut>(result.Error);

    /// <summary>Asynchronously chains a result with another operation if successful.</summary>
    public static async Task<Result<TOut>> BindAsync<TIn, TOut>(
        this Result<TIn> result,
        Func<TIn, Task<Result<TOut>>> func,
        CancellationToken ct = default) =>
        result.IsSuccess ? await func(result.Value) : Result.Failure<TOut>(result.Error);

    /// <summary>Maps the success value to a new type.</summary>
    public static Result<TOut> Map<TIn, TOut>(
        this Result<TIn> result,
        Func<TIn, TOut> mapper) =>
        result.IsSuccess ? Result.Success(mapper(result.Value)) : Result.Failure<TOut>(result.Error);

    /// <summary>Asynchronously maps the success value.</summary>
    public static async Task<Result<TOut>> MapAsync<TIn, TOut>(
        this Result<TIn> result,
        Func<TIn, Task<TOut>> mapper,
        CancellationToken ct = default) =>
        result.IsSuccess
            ? Result.Success(await mapper(result.Value))
            : Result.Failure<TOut>(result.Error);

    /// <summary>Executes a side-effect action if the result is a success.</summary>
    public static Result<TValue> Tap<TValue>(
        this Result<TValue> result,
        Action<TValue> action)
    {
        if (result.IsSuccess) action(result.Value);
        return result;
    }

    /// <summary>Returns true if the result is a failure of a specific type.</summary>
    public static bool IsErrorType(this Result result, ErrorType errorType) =>
        result.IsFailure && result.Error.Type == errorType;
}
