using System.Diagnostics;
using System.Reflection;
using MangaScrapper.Core.Common.Abstractions;
using MediatR;
using Microsoft.Extensions.Logging;

namespace MangaScrapper.Core.Common.Behaviors;

public sealed class LoggingBehavior<TRequest, TResponse>(
    ILogger<LoggingBehavior<TRequest, TResponse>> logger)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private const long SlowThresholdMs = 1000;
    private static readonly bool ShouldSkipLogging =
        typeof(TRequest).GetCustomAttribute<NoLoggingAttribute>(inherit: true) is not null;

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken ct)
    {
        if (ShouldSkipLogging)
        {
            return await next();
        }

        var requestType = typeof(TRequest);
        var requestName = requestType.Name;

        using var scope = logger.BeginScope(new Dictionary<string, object>
        {
            ["RequestName"] = requestName,
            ["RequestType"] = requestType.FullName ?? requestName
        });

        logger.LogDebug("Handling MediatR request {RequestName}", requestName);
        var stopwatch = Stopwatch.StartNew();

        try
        {
            var response = await next();
            stopwatch.Stop();
            var elapsedMs = stopwatch.ElapsedMilliseconds;

            if (elapsedMs > SlowThresholdMs)
            {
                logger.LogWarning(
                    "Long-running MediatR request {RequestName} completed in {ElapsedMs}ms (threshold: {SlowThreshold}ms)",
                    requestName, elapsedMs, SlowThresholdMs);
            }
            else
            {
                logger.LogInformation("Handled {RequestName} in {ElapsedMs}ms", requestName, elapsedMs);
            }

            return response;
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            logger.LogError(
                ex,
                "Failed handling MediatR request {RequestName} after {ElapsedMs}ms",
                requestName, stopwatch.ElapsedMilliseconds);
            throw;
        }
    }
}
