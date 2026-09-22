namespace NovaStack.SharedKernel.Results;

/// <summary>
/// Represents a result that is either a success or a failure with an <see cref="Error"/>.
/// </summary>
public class Result
{
    protected Result(bool isSuccess, Error error)
    {
        if (isSuccess && error != Error.None)
            throw new InvalidOperationException("A successful result cannot contain an error.");
        if (!isSuccess && error == Error.None)
            throw new InvalidOperationException("A failed result must contain an error.");

        IsSuccess = isSuccess;
        Error = error;
    }

    public bool IsSuccess { get; }
    public bool IsFailure => !IsSuccess;
    public Error Error { get; }

    // ── Factory methods ──────────────────────────────────────────────────
    public static Result Success() => new(true, Error.None);

    public static Result<TValue> Success<TValue>(TValue value) =>
        new(value, true, Error.None);

    public static Result Failure(Error error) => new(false, error);

    public static Result<TValue> Failure<TValue>(Error error) =>
        new(default, false, error);

    // ── Implicit conversion ──────────────────────────────────────────────
    public static implicit operator Result(Error error) => Failure(error);
}

/// <summary>
/// Represents a result that wraps a value of type <typeparamref name="TValue"/>.
/// </summary>
/// <typeparam name="TValue">The type of the success value.</typeparam>
public class Result<TValue> : Result
{
    private readonly TValue? _value;

    internal Result(TValue? value, bool isSuccess, Error error)
        : base(isSuccess, error)
    {
        _value = value;
    }

    /// <summary>Gets the success value. Throws if the result is a failure.</summary>
    public TValue Value => IsSuccess
        ? _value!
        : throw new InvalidOperationException("Cannot access the value of a failed result.");

    // ── Implicit conversions ─────────────────────────────────────────────
    public static implicit operator Result<TValue>(TValue value) => Success(value);
    public static implicit operator Result<TValue>(Error error) => Failure<TValue>(error);

    // ── Match ────────────────────────────────────────────────────────────
    public TOut Match<TOut>(Func<TValue, TOut> onSuccess, Func<Error, TOut> onFailure) =>
        IsSuccess ? onSuccess(Value) : onFailure(Error);

    public async Task<TOut> MatchAsync<TOut>(
        Func<TValue, Task<TOut>> onSuccess,
        Func<Error, Task<TOut>> onFailure,
        CancellationToken ct = default) =>
        IsSuccess ? await onSuccess(Value) : await onFailure(Error);
}
