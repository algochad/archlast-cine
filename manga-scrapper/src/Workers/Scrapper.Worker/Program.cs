using MangaScrapper.Core.DependencyInjection;
using Microsoft.Extensions.Hosting;
using NovaStack.Infrastructure.Logging;
using NovaStack.Infrastructure.Observability;
using Serilog;
using NovaStack.Infrastructure.DependencyInjection;
// ── Bootstrap logger (captures startup errors) ───────────────────────────────
LoggingExtensions.BootstrapLogger();

try
{
    var asciiArt = @"
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    __  ___                        _____                                              ______            _           
   /  |/  /___ _____  ____ _____ _/ ___/______________ _____  ____  ___  _____       / ____/___  ____ _(_)___  ___ 
  / /|_/ / __ `/ __ \/ __ `/ __ `/\__ \/ ___/ ___/ __ `/ __ \/ __ \/ _ \/ ___/      / __/ / __ \/ __ `/ / __ \/ _ \
 / /  / / /_/ / / / / /_/ / /_/ /___/ / /__/ /  / /_/ / /_/ / /_/ /  __/ /         / /___/ / / / /_/ / / / / /  __/
/_/  /_/\__,_/_/ /_/\__, /\__,_//____/\___/_/   \__,_/ .___/ .___/\___/_/         /_____/_/ /_/\__, /_/_/ /_/\___/ 
                   /____/                           /_/   /_/                                 /____/               
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
";
    Log.Information(asciiArt);
    Log.Information("Starting Scrapper.Worker...");

    AppDomain.CurrentDomain.UnhandledException += (sender, eventArgs) =>
    {
        if (eventArgs.ExceptionObject is Exception ex)
            Log.Fatal(ex, "Unhandled AppDomain exception occurred in Scrapper.Worker.");
    };

    TaskScheduler.UnobservedTaskException += (sender, eventArgs) =>
    {
        Log.Error(eventArgs.Exception, "Unobserved task exception occurred in Scrapper.Worker.");
        eventArgs.SetObserved();
    };

    var host = Host.CreateDefaultBuilder(args)
        .UseNovaStackSerilog()
        .ConfigureServices((hostContext, services) =>
        {
            // ── OpenTelemetry Observability ──────────────────────────────────────────
            services.AddNovaStackObservability(
                hostContext.Configuration,
                "Scrapper.Worker");

            // ── Core VSA Layer (MongoDB, Scrapers, Repositories, Hangfire Server & Jobs) ────
            services.AddMangaScrapperCore(
                hostContext.Configuration,
                includeHangfireServer: true,
                includeRabbitMqConsumer: true);
            services.AddNovaStackMappings(typeof(CoreExtensions).Assembly);
        })
        .Build();

    Log.Information("Scrapper.Worker is running...");

    await host.RunAsync();
}
catch (Exception ex) when (ex is not HostAbortedException)
{
    Log.Fatal(ex, "Scrapper.Worker terminated unexpectedly.");
}
finally
{
    Log.CloseAndFlush();
}
