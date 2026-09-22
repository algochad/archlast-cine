# 🚀 MangaScrapper LLM Context & Coding Specification

This document provides a token-efficient, high-density architectural and coding specification of **MangaScrapper**. It is designed to get LLM agents up to speed instantly with the project's refactored Vertical Slice Architecture (VSA), design patterns, coding conventions, and unified solution stack.

---

## 🛠️ Technology Stack

- **Runtime & Language**: .NET 10.0, C# 13.0
- **Architectural Style**: Vertical Slice Architecture (VSA) — Unified Two-Tier Structure (`MangaScrapper.Core` + Thin Host Executables)
- **CQRS & Mediator**: MediatR 14 (with logging and validation pipeline behaviors)
- **APIs & Real-Time**: ASP.NET Core Minimal APIs with automatic endpoint discovery (`IEndpointDefinition`) & **SignalR** Hubs (`MangaHub`)
- **Database & Persistence**: MongoDB 8 via `MongoDB.Driver` 3.x, Meilisearch 0.17 (full-text search), Qdrant 1.13 (vector search & ONNX in-process embeddings via `onnx-community/Qwen3-Embedding-0.6B-ONNX`)
- **Object Mapping**: Mapster 10.x (centralized in `MangaInfrastructureMapping.cs` & `MangaMappingConfig.cs`)
- **Validation**: FluentValidation 12
- **Error Handling**: Railway-oriented `Result<T>` and `Error` types (avoid domain exceptions for control flow)
- **Background Jobs**: Hangfire 1.8 with MongoDB Storage (`Hangfire.Mongo`)
- **Messaging & Event Bus**: Native RabbitMQ EventBus (`NovaStack.Infrastructure`) & Integration Event Handlers
- **Web Scrapers**: HtmlAgilityPack, Playwright, FlareSolverr HTTP integration
- **Testing**: xUnit, Moq, FluentAssertions, NetArchTest (Architecture validation)

---

## 📂 Project Structure

```text
├── src/
│   ├── BuildingBlocks/
│   │   ├── NovaStack.SharedKernel/        # Result<T>, Error, ICommand/IQuery, Base Entity, Result extensions
│   │   ├── NovaStack.Infrastructure/      # Shared Auth, RabbitMQ EventBus, MongoDB base extensions
│   │   └── NovaStack.Contracts/           # Shared Responses, Integration Events, DTO contracts
│   │
│   ├── Services/MangaScrapper/
│   │   ├── MangaScrapper.Core/            # Unified VSA Core Library Project
│   │   │   ├── Features/                  # 32 Vertical Feature Slices (Co-located Request, Handler, Endpoint)
│   │   │   │   ├── Mangas/                # GetPagedManga, GetMangaById, GetAllChapters, DeleteManga, UpdateManga
│   │   │   │   ├── ProviderScrapers/      # Komiku, Kiryuu, Komikcast, MangaDex slices
│   │   │   │   ├── Scrapper/              # GetAllProviders, ScrapChapterPages, GetQueue, FixFile
│   │   │   │   ├── UserLibrary/           # AddOrUpdateUserLibrary, GetUserLibrary, RemoveUserLibrary
│   │   │   │   ├── UserProgression/       # UpdateUserProgression, GetUserProgression, GetMangaProgression
│   │   │   │   ├── Users/                 # GetPagedUser, GetUserById, PatchUserActivity, RegisterFcmToken, UnregisterFcmToken
│   │   │   │   ├── Providers/             # GetProvider
│   │   │   │   ├── Dashboard/             # GetStatistics, SyncStorage, SyncQdrant, SyncMeilisearch
│   │   │   │   ├── Images/                # ProxyImage
│   │   │   │   └── RecurringJobs/         # GetRecurringJobs, CreateOrUpdate, Delete, Trigger
│   │   │   │
│   │   │   ├── Domain/                    # Domain Layer (Aggregates, Value Objects, Domain Events)
│   │   │   ├── Scrapers/                  # Scraper Provider Implementations (Komiku, Kiryuu, Komikcast, MangaDex)
│   │   │   ├── Persistence/               # Mongo DbContext, BSON Document schemas (MangaDocument, UserDocument, etc.)
│   │   │   ├── Repositories/              # MongoMangaRepository, MongoUserRepository, MongoUserLibraryRepository
│   │   │   ├── Services/                  # MeilisearchService, QdrantService, OnnxEmbeddingService (Qwen3-Embedding-0.6B-ONNX), DiscordWebhookService, StorageSyncService, FcmNotificationService
│   │   │   ├── Hubs/                      # SignalR Hubs (MangaHub)
│   │   │   ├── BackgroundJobs/            # Hangfire background jobs (MeiliSyncJob, DeleteMangaJob, LatestChapterScrapingJob)
│   │   │   ├── Messaging/                 # RabbitMQ handlers (ScrapChapterPagesHandler, ChapterPagesScrapedSignalRHandler, ChapterScrapingProgressSignalRHandler, UpsertMangaQdrantHandler, DeleteMangaHandler)
│   │   │   ├── Security/                  # Custom Auth validation & JwtAuthTokenService
│   │   │   └── DependencyInjection/       # CoreExtensions (AddMangaScrapperCore & MapMangaScrapperEndpoints)
│   │   │
│   │   ├── MangaScrapper.Api/             # Thin Web API Host entry point (Program.cs, Swagger/Scalar, Auth, SignalR mapping)
│   │   └── MangaPanel.Client/             # Blazor WebAssembly Frontend Client (SignalR Client, TailWind UI, Live Progress Bar)
│   │
│   └── Workers/
│       └── Scrapper.Worker/               # Thin Background Worker Host entry point (Hangfire Server & RabbitMQ Consumer)
│
├── tests/
│   ├── UnitTests/                         # Business logic tests (Moq + FluentAssertions)
│   ├── IntegrationTests/                  # Integration test harness
│   └── ArchitectureTests/                 # Architectural constraint tests (NetArchTest)
│
├── asyncapi.yaml                          # AsyncAPI 3.0.0 Specification (RabbitMQ, SignalR & FCM)
└── docker-compose.yml                     # Multi-container orchestration
```

---

## 🧱 Key Design Patterns & Coding Conventions

LLM agents MUST strictly adhere to these patterns when maintaining or extending this repository:

### 1. Single-File Vertical Slice Co-location Pattern
All feature slices inside `MangaScrapper.Core/Features/[Category]/[SliceName]/` MUST be co-located inside a single `{SliceName}.cs` file containing:
1. `Command` or `Query` record (implementing `ICommand<T>` or `IQuery<T>`)
2. Handler class (`internal sealed` or `public sealed`, implementing `ICommandHandler` or `IQueryHandler`)
3. Optional `Validator` class (implementing `AbstractValidator<T>`)
4. Endpoint Definition class (`public sealed class [SliceName]Endpoint : IEndpointDefinition`)

---

### 2. Dependency Injection & Service Registration

All services, MediatR handlers, validators, scrapers, background jobs, messaging consumers, and endpoints are registered in a single extension method `AddMangaScrapperCore()` in `CoreExtensions.cs`:

- **API Host (`MangaScrapper.Api/Program.cs`)**:
  ```csharp
  builder.Services.AddMangaScrapperCore(
      builder.Configuration,
      includeSignalRConsumer: true);
  app.MapMangaScrapperEndpoints();
  app.MapHub<MangaHub>("/hubs/manga");
  ```
- **Worker Host (`Scrapper.Worker/Program.cs`)**:
  ```csharp
  services.AddMangaScrapperCore(
      hostContext.Configuration,
      includeHangfireServer: true,
      includeRabbitMqConsumer: true);
  ```

> [!NOTE]
> `includeSignalRConsumer: true` enables ONLY the SignalR notification consumers (`chapter-pages-scraped` and `chapter-scraping-progress`) on the API host, preventing the API from consuming heavy worker job queues. `includeRabbitMqConsumer: true` on the worker enables background scraping task queues.

---

### 3. Real-Time Cross-Service Notifications & Progress Streaming (SignalR + RabbitMQ)

The architecture supports both incremental progress streaming and completion events:

1. **Live Scraping Progress Stream**:
   - As `Scrapper.Worker` downloads and converts each page to WebP in `GetChapterPage`, `ScrapChapterPagesHandler` publishes `ChapterScrapingProgressIntegrationEvent` (reporting `DownloadedPages`, `TotalPages`, `Percent`, `Status`) to RabbitMQ queue `"chapter-scraping-progress"`.
   - `ChapterScrapingProgressSignalRHandler` in `MangaScrapper.Api` consumes the event and broadcasts `"ChapterScrapingProgress"` via `IHubContext<MangaHub>` to group `$"manga-{mangaId}"` and all connected clients.
   - Blazor UI clients (`MangaDetailModal.razor`) render a live animated progress bar with exact page counters and chapter row indicators.

2. **Chapter Scraping Completion Broadcast**:
   - When a chapter finishes, `ScrapChapterPagesHandler` updates MongoDB and publishes `ChapterPagesScrapedIntegrationEvent` to RabbitMQ queue `"chapter-pages-scraped"`.
   - `ChapterPagesScrapedSignalRHandler` in `MangaScrapper.Api` consumes the event and broadcasts `"ChaptersUpdated"` via `IHubContext<MangaHub>`.
   - Blazor UI clients (`PublicMangaDetailPage.razor`, `MangaDetailModal.razor`) automatically re-query `GetAllChaptersQuery` without full-page reloads.

---

### 4. Domain Model Centralization & Scraper DDD Pattern

1. **Domain Aggregates**: All business rules, domain operations, and scraper abstractions center on the `Manga` Domain Aggregate (`MangaScrapper.Core.Aggregates.Manga`), `Chapter`, and `Page`.
2. **Domain-Driven Scrapers**: Scraper implementations (`KomikuService`, `KiryuuService`, `KomikcastService`, `MangaDexService`) construct and return `Manga`, `Chapter`, and `Page` domain aggregate instances instead of BSON document models.
3. **Document Mapping**: Mongo persistence converts transparently between `Manga` domain aggregates and `MangaDocument` BSON schemas using Mapster `.Adapt<T>()` or repository mappings.
4. **Mapster Registration**:
   - `MangaMappingConfig.cs` in Application handles `Manga` $\rightarrow$ `MangaSummaryResponse` / `ChapterResponse`.
   - `MangaInfrastructureMapping.cs` in Repositories handles `Manga` $\leftrightarrow$ `MangaDocument` and `MeiliMangaDocument`.

---

### 5. Automatic Minimal API Endpoint Registration

Endpoints are automatically discovered via reflection at startup by `MapMangaScrapperEndpoints()` scanning `MangaScrapper.Core`:
```csharp
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
```

---

### 6. Railway-Oriented Error Handling (`Result<T>`)

Do NOT throw domain exceptions for business validation failures. Use `Result.Success()` or `Result.Failure(Error)`:

```csharp
// Standard Error Definitions
Error.NotFound("Manga.NotFound", "Manga was not found.");
Error.Conflict("User.AlreadyExists", "Username is already taken.");
Error.Validation("Request.Invalid", "Search parameter cannot be empty.");
```

---

### 7. Push Notifications (Firebase Cloud Messaging - FCM)

For mobile clients (`Open-Manga-Reader` Flutter app), real-time push notifications are dispatched when new chapters are scraped:
1. **Device Token Registration**: The Flutter client calls `POST /api/v1/users/fcm-token` upon login to store the device token on `User.FcmTokens`.
2. **Library-Based Multicast**: When new chapters are detected in `ScrapperServiceBase.ExtractManga`, `FcmNotificationService` finds all users with that manga in `UserLibrary`, retrieves their device tokens, and dispatches an FCM multicast message in batches of 500.
3. **Topic Broadcasts**: Notifications are simultaneously published to the topic `$"manga_{mangaId:N}"` allowing instant client-side topic subscription.

---

### 8. Unique Identifier Generation

Always use `Guid.CreateVersion7()` instead of `Guid.NewGuid()` when generating new GUIDs for domain aggregates, events, and documents. This ensures sequential, time-sortable identifiers which provide better database indexing performance.

---

## 🧪 Verification & Testing Commands

To verify changes in this solution:

- **Build Solution**:
  ```bash
  dotnet build MangaScrapperStack.sln
  ```
- **Run Unit Tests**:
  ```bash
  dotnet test tests/UnitTests/UnitTests.csproj
  ```
- **Run Architecture Tests**:
  ```bash
  dotnet test tests/ArchitectureTests/ArchitectureTests.csproj
  ```
