using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Serilog;
using Serilog.Events;

namespace NovaStack.Infrastructure.Logging;

/// <summary>Serilog bootstrapping extensions for structured logging.</summary>
public static class LoggingExtensions
{
    /// <summary>
    /// Configures Serilog with console + file sinks.
    /// Call early in Program.cs before host is built.
    /// </summary>
    public static IHostBuilder UseNovaStackSerilog(
        this IHostBuilder hostBuilder) =>
        hostBuilder.UseSerilog((context, services, loggerConfig) =>
        {
            var useJsonConsole = context.Configuration.GetValue<bool>("Serilog:UseJsonConsole");

            loggerConfig
                .ReadFrom.Configuration(context.Configuration)
                .ReadFrom.Services(services)
                .MinimumLevel.Information()
                .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
                .MinimumLevel.Override("Microsoft.AspNetCore.StaticFiles", LogEventLevel.Warning)
                .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
                .MinimumLevel.Override("System", LogEventLevel.Warning)
                .MinimumLevel.Override("System.Net.Http.HttpClient", LogEventLevel.Warning)
                .MinimumLevel.Override("Hangfire", LogEventLevel.Information)
                .MinimumLevel.Override("RabbitMQ.Client", LogEventLevel.Warning)
                .Enrich.FromLogContext()
                .Enrich.WithMachineName()
                .Enrich.WithEnvironmentName()
                .Enrich.WithProcessId()
                .Enrich.WithThreadId()
                .Enrich.WithProperty("Application", context.HostingEnvironment.ApplicationName)
                .WriteTo.Async(wt =>
                {
                    if (useJsonConsole)
                    {
                        wt.Console(new Serilog.Formatting.Compact.CompactJsonFormatter());
                    }
                    else
                    {
                        wt.Console(
                            outputTemplate: "[{Timestamp:yyyy-MM-dd HH:mm:ss.fff} {Level:u3}] [{SourceContext}] {Message:lj}{NewLine}{Exception}");
                    }

                    wt.File(
                        path: $"logs/{context.HostingEnvironment.ApplicationName}-.log",
                        rollingInterval: RollingInterval.Day,
                        rollOnFileSizeLimit: true,
                        fileSizeLimitBytes: 20 * 1024 * 1024,
                        retainedFileCountLimit: 14,
                        outputTemplate: "[{Timestamp:yyyy-MM-dd HH:mm:ss.fff} {Level:u3}] [{SourceContext}] {Message:lj}{NewLine}{Exception}");

                    var otlpEndpoint = context.Configuration["Observability:OtlpEndpoint"];
                    if (string.IsNullOrWhiteSpace(otlpEndpoint))
                    {
                        otlpEndpoint = context.Configuration["Observability:AspireDashboard:Endpoint"];
                    }
                    if (string.IsNullOrWhiteSpace(otlpEndpoint))
                    {
                        otlpEndpoint = Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT");
                    }

                    var useAspire = context.Configuration.GetValue<bool>("Observability:AspireDashboard:Enabled")
                                    || context.Configuration.GetValue<bool>("Observability:UseAspireDashboard");

                    if (string.IsNullOrWhiteSpace(otlpEndpoint) && useAspire)
                    {
                        otlpEndpoint = "http://localhost:18889";
                    }

                    var serviceName = Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME")
                                      ?? context.Configuration["Observability:ServiceName"]
                                      ?? context.HostingEnvironment.ApplicationName;

                    var protocolStr = context.Configuration["Observability:AspireDashboard:Protocol"];
                    if (string.IsNullOrWhiteSpace(protocolStr))
                    {
                        protocolStr = context.Configuration["Observability:OtlpProtocol"];
                    }
                    if (string.IsNullOrWhiteSpace(protocolStr))
                    {
                        protocolStr = Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_PROTOCOL");
                    }

                    var isHttpProtobuf = string.Equals(protocolStr, "HttpProtobuf", StringComparison.OrdinalIgnoreCase) ||
                                         string.Equals(protocolStr, "http/protobuf", StringComparison.OrdinalIgnoreCase);

                    if (!string.IsNullOrWhiteSpace(otlpEndpoint))
                    {
                        wt.OpenTelemetry(options =>
                        {
                            options.Endpoint = otlpEndpoint;
                            options.Protocol = isHttpProtobuf
                                ? Serilog.Sinks.OpenTelemetry.OtlpProtocol.HttpProtobuf
                                : Serilog.Sinks.OpenTelemetry.OtlpProtocol.Grpc;
                            options.ResourceAttributes = new Dictionary<string, object>
                            {
                                ["service.name"] = serviceName
                            };
                        });
                    }
                });
        });

    /// <summary>Bootstraps a minimal logger for startup errors.</summary>
    public static void BootstrapLogger() =>
        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .WriteTo.Console()
            .CreateBootstrapLogger();
}
