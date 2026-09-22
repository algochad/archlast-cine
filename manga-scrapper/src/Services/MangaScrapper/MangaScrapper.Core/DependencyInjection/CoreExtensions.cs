using FluentValidation;
using MangaScrapper.Core.Aggregates;
using Hangfire;
using Hangfire.Mongo;
using Hangfire.Mongo.Migration.Strategies;
using Hangfire.Mongo.Migration.Strategies.Backup;
using MangaScrapper.Core.BackgroundJobs;
using MangaScrapper.Core.Common.Abstractions;
using MangaScrapper.Core.Common.Behaviors;
using MangaScrapper.Core.Configuration;
using MangaScrapper.Core.Messaging;
using MangaScrapper.Core.Persistence;
using MangaScrapper.Core.Repositories;
using MangaScrapper.Core.Scrapers;
using MangaScrapper.Core.Scrapers.DoujinDesu;
using MangaScrapper.Core.Scrapers.Kiryuu;
using MangaScrapper.Core.Scrapers.Komikcast;
using MangaScrapper.Core.Scrapers.Komiku;
using MangaScrapper.Core.Scrapers.Komiktap;
using MangaScrapper.Core.Scrapers.Manhwadesu;
using MangaScrapper.Core.Scrapers.MangaDex;
using MangaScrapper.Core.Scrapers.Softkomik;
using MangaScrapper.Core.RateLimiting;
using MangaScrapper.Core.Security;
using MangaScrapper.Core.Services;
using MediatR;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Bson.Serialization.Conventions;
using MongoDB.Bson.Serialization.Serializers;
using MongoDB.Driver;
using NovaStack.Contracts.IntegrationEvents;
using NovaStack.Infrastructure.Authentication;
using NovaStack.Infrastructure.DependencyInjection;
using NovaStack.Infrastructure.Messaging.Options;
using NovaStack.Infrastructure.Persistence.MongoDb;
using NovaStack.SharedKernel.Abstractions;
using CustomAuthSchemeOptions = MangaScrapper.Core.Security.CustomAuthSchemeOptions;
using CustomAuthValidation = MangaScrapper.Core.Security.CustomAuthValidation;

namespace MangaScrapper.Core.DependencyInjection;

public static class CoreExtensions
{
    public static IServiceCollection AddMangaScrapperCore(
        this IServiceCollection services,
        IConfiguration configuration,
        bool includeHangfireServer = false,
        bool includeRabbitMqConsumer = false)
    {
        var assembly = typeof(CoreExtensions).Assembly;

        // MediatR & CQRS Behaviors
        services.AddMediatR(cfg =>
        {
            cfg.RegisterServicesFromAssembly(assembly);
            cfg.AddBehavior(typeof(IPipelineBehavior<,>), typeof(LoggingBehavior<,>));
            cfg.AddBehavior(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));
        });

        // FluentValidation
        services.AddValidatorsFromAssembly(assembly);

        // SignalR Real-Time Notifications
        services.AddSignalR();

        // Core Subsystems
        services
            .AddMongoDb(configuration)
            .AddRepositories()
            .AddExternalServices(configuration)
            .AddScraperServices(configuration)
            .AddHangfireWithMongo(configuration, includeHangfireServer)
            .AddRabbitMqMessaging(configuration, includeRabbitMqConsumer)
            .AddSecurityServices()
            .AddFirebaseApp(configuration)
            .AddMangaScrapperRateLimiting(configuration);

        return services;
    }

    public static WebApplication MapMangaScrapperEndpoints(this WebApplication app)
    {
        var endpointDefinitions = typeof(CoreExtensions).Assembly
            .GetTypes()
            .Where(t => typeof(IEndpointDefinition).IsAssignableFrom(t)
                        && t is { IsInterface: false, IsAbstract: false })
            .Select(Activator.CreateInstance)
            .Cast<IEndpointDefinition>();

        foreach (var definition in endpointDefinitions)
            definition.DefineEndpoints(app);

        return app;
    }

    private static IServiceCollection AddMongoDb(this IServiceCollection services, IConfiguration configuration)
    {
        var pack = new ConventionPack
        {
            new CamelCaseElementNameConvention(),
            new IgnoreIfNullConvention(true),
            new EnumRepresentationConvention(BsonType.String)
        };
        ConventionRegistry.Register("MangaScrapperConventions", pack, _ => true);

        try
        {
            BsonSerializer.RegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));
        }
        catch (BsonSerializationException)
        {
            // Already registered
        }

        var mongoSettings = configuration.GetSection("MongoDB").Get<MongoSettings>()
                            ?? new MongoSettings();

        services.Configure<MongoSettings>(configuration.GetSection("MongoDB"));
        services.AddSingleton<IMongoClient>(_ => new MongoClient(mongoSettings.ConnectionString));
        services.AddScoped<MangaMongoDbContext>(sp =>
        {
            var client = sp.GetRequiredService<IMongoClient>();
            return new MangaMongoDbContext(client, mongoSettings.DatabaseName);
        });

        return services;
    }

    private static IServiceCollection AddRepositories(this IServiceCollection services)
    {
        services.AddScoped<IMangaRepository, MongoMangaRepository>();
        services.AddScoped<IUserRepository, MongoUserRepository>();
        services.AddScoped<IUserLibraryRepository, MongoUserLibraryRepository>();
        services.AddScoped<IUserProgressionRepository, MongoUserProgressionRepository>();

        return services;
    }

    private static IServiceCollection AddExternalServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<MeiliConfig>(configuration.GetSection("Meili"));
        services.Configure<QdrantConfig>(configuration.GetSection("Qdrant"));
        services.Configure<EmbeddingConfig>(configuration.GetSection("Embedding"));
        services.Configure<DiscordWebhookSettings>(configuration.GetSection("Discord"));
        services.Configure<DomainSettings>(configuration.GetSection("Domain"));
        services.Configure<ScrapperSettings>(configuration.GetSection("Scrapper"));
        services.Configure<FlareSolverrSettings>(configuration.GetSection("FlareSolverr"));

        services.AddSingleton<IEmbeddingService, OnnxEmbeddingService>();
        services.AddScoped<MeilisearchService>();
        services.AddScoped<QdrantService>();
        services.AddScoped<StorageSyncService>();
        services.AddScoped<FcmNotificationService>();

        services.AddScoped<IMangaExternalRepository, MangaExternalService>();
        services.AddScoped<IMangaMessagePublisher, MangaMessagePublisher>();
        services.AddScoped<IExternalMetadataService, ExternalMetadataService>();

        services.AddHttpClient<DiscordWebhookService>();

        services.AddScoped<IScrapperSettingsProvider, ScrapperSettingsProvider>();
        services.AddScoped<IRecurringJobsService, RecurringJobsService>();

        return services;
    }

    private static IServiceCollection AddScraperServices(this IServiceCollection services, IConfiguration configuration)
    {
        var scrapperSettings = configuration.GetSection("Scrapper").Get<ScrapperSettings>() ?? new ScrapperSettings();
        var flareSolverrSettings = configuration.GetSection("FlareSolverr").Get<FlareSolverrSettings>() ?? new FlareSolverrSettings();

        services.AddSingleton(_ => new SemaphoreSlim(scrapperSettings.MaxParallelDownloads, scrapperSettings.MaxParallelDownloads));

        services.AddHttpClient("FlareSolverr", client =>
        {
            client.BaseAddress = new Uri(flareSolverrSettings.Host);
            client.Timeout = TimeSpan.FromSeconds(120);
        });

        services.AddScoped<FlareSolverrService>(sp =>
        {
            var factory = sp.GetRequiredService<IHttpClientFactory>();
            var http = factory.CreateClient("FlareSolverr");
            return new FlareSolverrService(http, factory, flareSolverrSettings.Enabled);
        });

        services.AddHttpClient<KomikuService>();
        services.AddHttpClient<KiryuuService>();
        services.AddHttpClient<KomikcastService>();
        services.AddHttpClient<MangaDexService>();
        services.AddHttpClient<KomiktapService>();
        services.AddHttpClient<ManhwadesuService>();
        services.AddHttpClient<DoujinDesuService>();
        services.AddHttpClient<SoftkomikService>();

        services.AddScoped<KomikuService>();
        services.AddScoped<KiryuuService>();
        services.AddScoped<KomikcastService>();
        services.AddScoped<MangaDexService>();
        services.AddScoped<KomiktapService>();
        services.AddScoped<ManhwadesuService>();
        services.AddScoped<DoujinDesuService>();
        services.AddScoped<SoftkomikService>();

        services.AddKeyedScoped<IScrapperService, KomikuService>("komiku");
        services.AddKeyedScoped<IScrapperService, KiryuuService>("kiryuu");
        services.AddKeyedScoped<IScrapperService, KomikcastService>("komikcast");
        services.AddKeyedScoped<IScrapperService, MangaDexService>("mangadex");
        services.AddKeyedScoped<IScrapperService, KomiktapService>("komiktap");
        services.AddKeyedScoped<IScrapperService, ManhwadesuService>("manhwadesu");
        services.AddKeyedScoped<IScrapperService, DoujinDesuService>("doujindesu");
        services.AddKeyedScoped<IScrapperService, SoftkomikService>("softkomik");

        services.AddKeyedScoped<IProviderScrapperService, KomikuService>("komiku");
        services.AddKeyedScoped<IProviderScrapperService, KiryuuService>("kiryuu");
        services.AddKeyedScoped<IProviderScrapperService, KomikcastService>("komikcast");
        services.AddKeyedScoped<IProviderScrapperService, MangaDexService>("mangadex");
        services.AddKeyedScoped<IProviderScrapperService, KomiktapService>("komiktap");
        services.AddKeyedScoped<IProviderScrapperService, ManhwadesuService>("manhwadesu");
        services.AddKeyedScoped<IProviderScrapperService, DoujinDesuService>("doujindesu");
        services.AddKeyedScoped<IProviderScrapperService, SoftkomikService>("softkomik");

        services.AddScoped<IScrapperQueueService, ScrapperQueueService>();
        services.AddSingleton<IScrapingCancellationManager, ScrapingCancellationManager>();
        services.AddSingleton<IScrapingProcessTracker, ScrapingProcessTracker>();
        services.AddSingleton<IScrapingProgressBroadcaster, WorkerSignalRBroadcaster>();

        return services;
    }


    private static IServiceCollection AddHangfireWithMongo(
        this IServiceCollection services,
        IConfiguration configuration,
        bool includeHangfireServer = false)
    {
        var mongoSettings = configuration.GetSection("MongoDB").Get<MongoSettings>() ?? new MongoSettings();

        services.AddHangfire((sp, config) =>
        {
            var mongoClient = sp.GetRequiredService<IMongoClient>();
            config.UseSimpleAssemblyNameTypeSerializer()
                  .UseRecommendedSerializerSettings()
                  .UseMongoStorage(mongoClient, mongoSettings.DatabaseName, new MongoStorageOptions
                  {
                      Prefix = "hangfire.mongo",
                      CheckConnection = true,
                      MigrationOptions = new MongoMigrationOptions
                      {
                          MigrationStrategy = new MigrateMongoMigrationStrategy(),
                          BackupStrategy = new CollectionMongoBackupStrategy()
                      },
                      CheckQueuedJobsStrategy = CheckQueuedJobsStrategy.TailNotificationsCollection
                  });
        });

        if (includeHangfireServer)
        {
            services.AddHangfireServer(opts =>
            {
                opts.Queues = new[] { "default" };
                opts.WorkerCount = Environment.ProcessorCount * 2;
            });
        }

        services.AddTransient<MeiliSyncJob>();
        services.AddTransient<DeleteMangaJob>();
        services.AddTransient<LatestChapterScrapingJob>();

        return services;
    }

    private static IServiceCollection AddRabbitMqMessaging(
        this IServiceCollection services,
        IConfiguration configuration,
        bool includeWorkerConsumer)
    {
        services.Configure<MessagingOptions>(configuration.GetSection(MessagingOptions.SectionName));

        services.AddNativeRabbitMqEventBus();

        services.AddScoped<ScrapChapterPagesHandler>();
        services.AddScoped<DeleteMangaHandler>();
        services.AddScoped<DeleteChapterHandler>();
        
        services.AddScoped<SyncStorageHandler>();
        services.AddScoped<SyncQdrantHandler>();
        services.AddScoped<SyncMeilisearchHandler>();
        services.AddScoped<SyncAnilistHandler>();
        services.AddScoped<UpsertMangaQdrantHandler>();
        services.AddScoped<ScrapMangaHandler>();
        services.AddScoped<ChapterPagesScrapedSignalRHandler>();
        services.AddScoped<ChapterScrapingProgressSignalRHandler>();
        services.AddScoped<CancelScrapingHandler>();

        if (includeWorkerConsumer)
        {
            services.AddRabbitMqConsumer<ScrapMangaIntegrationEvent, ScrapMangaHandler>(
                "scrape-manga");

            services.AddRabbitMqConsumer<ScrapChapterPagesIntegrationEvent, ScrapChapterPagesHandler>(
                "scrape-chapter-pages");

            services.AddRabbitMqConsumer<CancelScrapingIntegrationEvent, CancelScrapingHandler>(
                "cancel-scraping");
                
            services.AddRabbitMqConsumer<DeleteMangaIntegrationEvent, DeleteMangaHandler>(
                "delete-manga");

                
            services.AddRabbitMqConsumer<DeleteChapterIntegrationEvent, DeleteChapterHandler>(
                "delete-chapter");
                
            services.AddRabbitMqConsumer<SyncStorageIntegrationEvent, SyncStorageHandler>(
                "sync-storage");
                
            services.AddRabbitMqConsumer<SyncQdrantIntegrationEvent, SyncQdrantHandler>(
                "sync-qdrant");
                
            services.AddRabbitMqConsumer<SyncMeilisearchIntegrationEvent, SyncMeilisearchHandler>(
                "sync-meilisearch");

            services.AddRabbitMqConsumer<SyncAnilistIntegrationEvent, SyncAnilistHandler>(
                "sync-anilist");

            services.AddRabbitMqConsumer<UpsertMangaQdrantIntegrationEvent, UpsertMangaQdrantHandler>(
                "upsert-manga-qdrant");
        }

        return services;
    }

    private static IServiceCollection AddSecurityServices(this IServiceCollection services)
    {
        services.AddAuthentication(options =>
        {
            options.DefaultScheme = "CustomAuth";
            options.DefaultChallengeScheme = "CustomAuth";
        })
        .AddCookie(CookieAuthenticationDefaults.AuthenticationScheme, opts =>
        {
            opts.Cookie.Name = "MangaScrapper.Auth";
            opts.Cookie.HttpOnly = true;
            opts.Cookie.SameSite = Microsoft.AspNetCore.Http.SameSiteMode.Strict;
            opts.ExpireTimeSpan = TimeSpan.FromDays(30);
            opts.Events.OnRedirectToLogin = ctx =>
            {
                ctx.Response.StatusCode = 401;
                return Task.CompletedTask;
            };
            opts.Events.OnRedirectToAccessDenied = ctx =>
            {
                ctx.Response.StatusCode = 403;
                return Task.CompletedTask;
            };
        })
        .AddScheme<CustomAuthSchemeOptions, CustomAuthValidation>("CustomAuth", _ => { });

        services.AddRouting();
        services.AddAuthorization(options =>
        {
            options.AddPolicy(User.UserRoles.SuperUser, policy =>
                policy.RequireRole(User.UserRoles.SuperUser));
            options.AddPolicy(User.UserRoles.Admin, policy =>
                policy.RequireRole(User.UserRoles.Admin));
            options.AddPolicy(User.UserRoles.User, policy =>
                policy.RequireRole(User.UserRoles.User));
        });

        services.AddHttpContextAccessor();
        services.AddScoped<IClaimService, ClaimService>();

        services.AddScoped<IAuthTokenService, JwtAuthTokenService>();

        var keysPath = Environment.GetEnvironmentVariable("DATAPROTECTION_KEYS_PATH") ?? "/app/keys";
        services.AddDataProtection()
            .PersistKeysToFileSystem(new System.IO.DirectoryInfo(keysPath))
            .SetApplicationName("MangaScrapper");

        return services;
    }

    private static IServiceCollection AddFirebaseApp(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<FirebaseSettings>(configuration.GetSection("Firebase"));

        try
        {
            var credentialPath = configuration["Firebase:CredentialPath"];
            if (!string.IsNullOrEmpty(credentialPath) && File.Exists(credentialPath))
            {
                Environment.SetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", credentialPath);
                if (FirebaseAdmin.FirebaseApp.DefaultInstance is null)
                {
                    FirebaseAdmin.FirebaseApp.Create();
                    Serilog.Log.Information("FirebaseApp initialized with credentials from: {CredentialPath}", credentialPath);
                }
            }
            else
            {
                string? fallbackPath = null;
                if (!string.IsNullOrEmpty(credentialPath))
                {
                    var directory = Path.GetDirectoryName(credentialPath);
                    if (!string.IsNullOrEmpty(directory) && Directory.Exists(directory))
                    {
                        fallbackPath = Directory.GetFiles(directory, "*.json").FirstOrDefault();
                    }
                }

                if (!string.IsNullOrEmpty(fallbackPath) && File.Exists(fallbackPath))
                {
                    Environment.SetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", fallbackPath);
                    if (FirebaseAdmin.FirebaseApp.DefaultInstance is null)
                    {
                        FirebaseAdmin.FirebaseApp.Create();
                        Serilog.Log.Information("FirebaseApp initialized with fallback credentials from: {FallbackPath}", fallbackPath);
                    }
                }
                else
                {
                    var hasGcpDefault = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS")) ||
                                        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("GAE_INSTANCE")) ||
                                        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("K_SERVICE"));

                    if (hasGcpDefault)
                    {
                        if (FirebaseAdmin.FirebaseApp.DefaultInstance is null)
                        {
                            FirebaseAdmin.FirebaseApp.Create();
                            Serilog.Log.Information("FirebaseApp initialized with GCP default credentials.");
                        }
                    }
                    else
                    {
                        Serilog.Log.Warning("FirebaseApp was NOT initialized: No credentials file found and not running on GCP.");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Serilog.Log.Error(ex, "FirebaseApp initialization failed: {ErrorMessage}", ex.Message);
        }

        return services;
    }
}

