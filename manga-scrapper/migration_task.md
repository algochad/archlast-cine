# MangaScrapper → NovaStack Migration Task List

---

## Phase 1 — BuildingBlocks Extension

### 1.1 NovaStack.SharedKernel
- [x] Verify `Entity<TId>`, `IAggregateRoot<TId>`, `IHasDomainEvents` exist
- [x] Verify `Guard` class covers null, empty string, range checks
- [x] Verify `Result<T>` / `Result` / `Error` / `ErrorType` types are complete
- [x] Add `Guard.NotEmpty<T>(IEnumerable<T>)` if missing
- [x] Verify `DomainException` is present

### 1.2 NovaStack.Infrastructure — Persistence/MongoDb
- [x] Verify `IMongoDbContext` and `MongoDbContextBase` exist
- [x] Verify MongoDB camelCase convention registration helper is in place
- [x] Verify `GuidSerializer(GuidRepresentation.Standard)` registration in bootstrap

### 1.3 NovaStack.Infrastructure — Observability
- [x] Create `ObservabilityExtensions.AddMangaScrapperOtel(...)` — wraps current OTel setup from `Program.cs`:
  - Tracing: AspNetCore, HttpClient, MongoDB sources
  - Metrics: AspNetCore, HttpClient, Runtime, Process, Prometheus exporter
  - Logging: OTLP exporter (conditional on env var)

### 1.4 NovaStack.Infrastructure — Authentication
- [x] Move `CustomAuthSchemeOptions` and `CustomAuthValidation` into `MangaScrapper.Infrastructure/Security/`
- [x] Create `AuthExtensions.AddMangaScrapperAuth(...)` — Cookie + CustomAuth + Data Protection wiring

### 1.5 NovaStack.Infrastructure — Http
- [x] Move `HttpConfig` (ConfigureClient + CreateHandler) to `NovaStack.Infrastructure/Http/HttpConfig.cs`
- [x] Create named client registration helpers

### 1.6 NovaStack.Contracts
- [x] Verify `ApiResponse<T>` wrapper exists
- [x] Add `MangaSummaryResponse` record
- [x] Add `ChapterResponse` record
- [x] Add `UserLibraryResponse` record
- [x] Add `UserProgressionResponse` record
- [x] Add `DashboardStatisticResponse` record
- [x] Add `ScrapStatsResponse` record
- [x] Add `StorageSyncReportResponse` record
- [x] Migrate `MangaScrapper.Shared/Models/` DTOs → `NovaStack.Contracts/Responses/`

---

## Phase 2 — MangaScrapper.Domain (NEW PROJECT)

### 2.1 Project Setup
- [x] Create `src/Services/MangaScrapper/MangaScrapper.Domain/MangaScrapper.Domain.csproj`
- [x] Add reference to `NovaStack.SharedKernel`
- [x] Add project to `MangaScrapperStack.sln` under `Services/MangaScrapper` folder

### 2.2 Value Objects
- [x] Create `ValueObjects/MangaId.cs` (strongly-typed Guid wrapper)
- [x] Create `ValueObjects/ChapterId.cs`
- [x] Create `ValueObjects/UserId.cs`
- [x] Create `ValueObjects/MangaSource.cs` (enum: Komiku, Kiryuu, Komikcast, MangaDex)
- [x] Create `ValueObjects/MangaStatus.cs` (enum: Ongoing, Completed, Hiatus)

### 2.3 Domain Aggregates
- [x] Create `Aggregates/Manga.cs` — `Entity<MangaId>` with:
  - Properties: `Title`, `Slug`, `CoverImage`, `Status`, `Source`, `Genres`, `Chapters`, `TotalView`, `LastUpdated`
  - Factory: `Manga.Create(...)`
  - Factory: `Manga.Reconstitute(...)` (for MongoDB hydration, no events raised)
  - Methods: `UpdateMetadata(...)`, `AddChapter(...)`, `DeleteChapter(...)`
  - Domain Events: `MangaCreatedDomainEvent`, `ChapterScrapedDomainEvent`
- [x] Create `Aggregates/UserLibrary.cs` — `Entity<Guid>` with:
  - Properties: `UserId`, `MangaId`, `AddedAt`
  - Factory: `UserLibrary.Create(...)`, `UserLibrary.Reconstitute(...)`
  - Domain Event: `UserLibraryUpdatedDomainEvent`
- [x] Create `Aggregates/UserProgression.cs` — `Entity<Guid>` with:
  - Properties: `UserId`, `MangaId`, `LastReadChapterId`, `LastReadAt`
  - Factory: `UserProgression.Create(...)`, `UserProgression.Reconstitute(...)`
  - Method: `UpdateProgression(...)`

### 2.4 Domain Events
- [x] Create `DomainEvents/MangaCreatedDomainEvent.cs`
- [x] Create `DomainEvents/ChapterScrapedDomainEvent.cs`
- [x] Create `DomainEvents/UserLibraryUpdatedDomainEvent.cs`

### 2.5 Repository Interfaces
- [x] Move `IMangaRepository.cs` → `Repositories/IMangaRepository.cs` (update to use domain types)
- [x] Move `IUserLibraryRepository.cs` → `Repositories/IUserLibraryRepository.cs`
- [x] Move `IUserProgressionRepository.cs` → `Repositories/IUserProgressionRepository.cs`

---

## Phase 3 — MangaScrapper.Application (NEW PROJECT)

### 3.1 Project Setup
- [x] Create `src/Services/MangaScrapper/MangaScrapper.Application/MangaScrapper.Application.csproj`
- [x] Add references: `MangaScrapper.Domain`, `NovaStack.SharedKernel`, `NovaStack.Contracts`
- [x] Add NuGet: `MediatR`, `FluentValidation`, `Mapster`
- [x] Add project to `MangaScrapperStack.sln`

### 3.2 Common Abstractions
- [x] Create `Common/Abstractions/ICommand.cs` — `IRequest<Result>` / `IRequest<Result<T>>`
- [x] Create `Common/Abstractions/IQuery.cs` — `IRequest<Result<T>>`
- [x] Create `Common/Abstractions/ICommandHandler.cs`
- [x] Create `Common/Abstractions/IQueryHandler.cs`
- [x] Create `Common/Abstractions/IEndpointDefinition.cs`
- [x] Create `Common/Behaviors/ValidationBehavior.cs` — MediatR pipeline behavior for FluentValidation
- [x] Create `Common/Behaviors/LoggingBehavior.cs` — MediatR pipeline behavior for structured logging
- [x] Create `Common/Extensions/ApplicationExtensions.cs` — `AddMangaScrapperApplication()` DI method

### 3.3 Feature: Manga
- [x] `Features/Manga/GetPagedManga/` — Query + Handler (Mongo paged query) + Validator + Endpoint (`GET /api/v1/manga`)
- [x] `Features/Manga/GetMangaById/` — Query + Handler + Endpoint (`GET /api/v1/manga/{id}`)
- [x] `Features/Manga/GetAllChapters/` — Query + Handler + Endpoint
- [ ] `Features/Manga/GetChaptersPage/` — Query + Handler + Endpoint
- [x] `Features/Manga/GetAllGenre/` — Query + Handler + Endpoint
- [x] `Features/Manga/GetAllType/` — Query + Handler + Endpoint
- [ ] `Features/Manga/GetTrending/` — Query + Handler + Endpoint
- [ ] `Features/Manga/GetRecommendations/` — Query + Handler (Qdrant delegate) + Endpoint
- [ ] `Features/Manga/UpdateManga/` — Command + Handler + Validator + Endpoint (`PUT /api/v1/manga/{id}`)
- [ ] `Features/Manga/DeleteManga/` — Command + Handler + Endpoint (`DELETE /api/v1/manga/{id}`)
- [ ] `Features/Manga/DeleteChapter/` — Command + Handler + Endpoint
- [ ] `Features/Manga/SyncMeili/` — Command + Handler + Endpoint
- [ ] `Features/Manga/SyncQdrant/` — Command + Handler + Endpoint

### 3.4 Feature: Scrapper (generic)
- [x] `Features/Scrapper/ScrapChapterPages/` — Command + Handler (queues Hangfire job) + Validator + Endpoint
- [x] `Features/Scrapper/SearchJikan/` — Query + Handler (Jikan HTTP call) + Endpoint
- [x] `Features/Scrapper/UpdateMangaMetaData/` — Command + Handler + Validator + Endpoint
- [x] `Features/Scrapper/GetAllProvider/` — Query + Handler + Endpoint
- [x] `Features/Scrapper/GetQueue/` — Query + Handler + Endpoint
- [x] `Features/Scrapper/ClearQueueErrors/` — Command + Handler + Endpoint
- [x] `Features/Scrapper/FixFile/` — Command + Handler + Endpoint
- [x] `Features/Scrapper/FixLanguage/` — Command + Handler + Endpoint

### 3.5 Feature: ScrapperKomiku
- [x] `Features/ScrapperKomiku/GetDetail/` — Query + Handler + Endpoint
- [x] `Features/ScrapperKomiku/ScrapManga/` — Command + Handler + Endpoint
- [x] `Features/ScrapperKomiku/Search/` — Query + Handler + Endpoint

### 3.6 Feature: ScrapperKiryuu
- [x] `Features/ScrapperKiryuu/GetDetail/` — Query + Handler + Endpoint
- [x] `Features/ScrapperKiryuu/ScrapManga/` — Command + Handler + Endpoint
- [x] `Features/ScrapperKiryuu/Search/` — Query + Handler + Endpoint

### 3.7 Feature: ScrapperKomikcast
- [x] `Features/ScrapperKomikcast/GetDetail/` — Query + Handler + Endpoint
- [x] `Features/ScrapperKomikcast/ScrapManga/` — Command + Handler + Endpoint
- [x] `Features/ScrapperKomikcast/Search/` — Query + Handler + Endpoint

### 3.8 Feature: ScrapperMangadex
- [x] `Features/ScrapperMangadex/GetDetail/` — Query + Handler + Endpoint
- [x] `Features/ScrapperMangadex/ScrapManga/` — Command + Handler + Endpoint
- [x] `Features/ScrapperMangadex/Search/` — Query + Handler + Endpoint

### 3.9 Feature: Auth
- [x] `Features/Auth/Login/` — Command + Handler + Validator + Endpoint (`POST /api/auth/login`)
- [x] `Features/Auth/Logout/` — Command + Handler + Endpoint (`POST /api/auth/logout`)
- [x] `Features/Auth/Register/` — Command + Handler + Validator + Endpoint (`POST /api/auth/register`)
- [x] `Features/Auth/UserInfo/` — Query + Handler + Endpoint (`GET /api/auth/me`)
- [x] `Features/Auth/FirebaseVerify/` — Command + Handler + Endpoint (`POST /api/auth/firebase-verify`)

### 3.10 Feature: Dashboard
- [x] `Features/Dashboard/GetStatistics/` — Query + Handler + Endpoint (`GET /api/v1/dashboard/stats`)
- [x] `Features/Dashboard/SyncStorage/` — Command + Handler + Endpoint (`POST /api/v1/dashboard/sync-storage`)

### 3.11 Feature: RecurringJobs
- [x] `Features/RecurringJobs/CreateOrUpdateRecurringJob/` — Command + Handler + Endpoint
- [x] `Features/RecurringJobs/DeleteRecurringJob/` — Command + Handler + Endpoint
- [x] `Features/RecurringJobs/GetRecurringJobs/` — Query + Handler + Endpoint
- [x] `Features/RecurringJobs/TriggerRecurringJob/` — Command + Handler + Endpoint

### 3.12 Feature: UserLibrary
- [x] `Features/UserLibrary/AddOrUpdateUserLibrary/` — Command + Handler + Validator + Endpoint
- [x] `Features/UserLibrary/GetUserLibrary/` — Query + Handler + Endpoint
- [x] `Features/UserLibrary/RemoveUserLibrary/` — Command + Handler + Endpoint

### 3.13 Feature: UserProgression
- [x] `Features/UserProgression/UpdateUserProgression/` — Command + Handler + Validator + Endpoint
- [x] `Features/UserProgression/GetUserProgression/` — Query + Handler + Endpoint
- [x] `Features/UserProgression/GetMangaProgression/` — Query + Handler + Endpoint

### 3.14 Feature: Images
- [x] `Features/Images/ProxyImage/` — Query + Handler + Endpoint (`GET /api/v1/images/proxy`)

---

## Phase 4 — MangaScrapper.Infrastructure (NEW PROJECT)

### 4.1 Project Setup
- [x] Create `src/Services/MangaScrapper/MangaScrapper.Infrastructure/MangaScrapper.Infrastructure.csproj`
- [x] Add references: `MangaScrapper.Domain`, `NovaStack.Infrastructure`, `NovaStack.SharedKernel`
- [x] Add NuGet: `MongoDB.Driver`, `Hangfire.AspNetCore`, `Hangfire.Mongo`, `MeiliSearch`, `Qdrant.Client`, `HtmlAgilityPack`, `Microsoft.Playwright`, `SkiaSharp`, `FirebaseAdmin`, `Google.Apis.Auth`, `Isopoh.Cryptography.Argon2`, `OpenTelemetry.*`
- [x] Add project to `MangaScrapperStack.sln`

### 4.2 Persistence — MongoDB Context
- [x] Create `Persistence/MangaMongoDbContext.cs` — extends `MongoDbContextBase`:
  - Exposes: `Mangas`, `UserLibraries`, `UserProgressions`, `Users` collections
- [x] Create `Persistence/Documents/MangaDocument.cs` (migrate from `Infrastructure/Mongo/Collections/`)
- [x] Create `Persistence/Documents/UserDocument.cs`
- [x] Create `Persistence/Documents/UserLibraryDocument.cs`
- [x] Create `Persistence/Documents/UserProgressionDocument.cs`

### 4.3 Repositories
- [x] Create `Repositories/MongoMangaRepository.cs` — implements `IMangaRepository`:
  - `GetByIdAsync`, `GetByTitleAsync`, `GetPagedAsync`, `AddAsync`, `UpdateAsync`, `DeleteAsync`
  - Uses `Manga.Reconstitute(...)` for mapping
- [x] Create `Repositories/MongoUserLibraryRepository.cs` — implements `IUserLibraryRepository`
- [x] Create `Repositories/MongoUserProgressionRepository.cs` — implements `IUserProgressionRepository`

### 4.4 External Services
- [x] Migrate `Infrastructure/Services/MeilisearchService.cs` → `Services/MeilisearchService.cs`
- [x] Migrate `Infrastructure/Services/QdrantService.cs` → `Services/QdrantService.cs`
- [x] Migrate `Infrastructure/Services/StorageSyncService.cs` → `Services/StorageSyncService.cs`
- [x] Migrate `Infrastructure/Services/FlareSolverrService.cs` → `Services/FlareSolverrService.cs`
- [x] Migrate `Infrastructure/Services/DiscordWebhookService.cs` → `Services/DiscordWebhookService.cs`

### 4.5 Scraper HTTP Services
- [x] Migrate `Features/ScrapperKomiku/Services/KomikuService.cs` → `Scrapers/KomikuService.cs`
- [x] Migrate `Features/ScrapperKiryuu/Services/KiryuuService.cs` → `Scrapers/KiryuuService.cs`
- [x] Migrate `Features/ScrapperKomikcast/Services/KomikcastService.cs` → `Scrapers/KomikcastService.cs`
- [x] Migrate `Features/ScrapperMangadex/Services/MangaDexService.cs` → `Scrapers/MangaDexService.cs`
- [x] Migrate `Infrastructure/Services/ScrapperService.cs` → `Scrapers/ScrapperService.cs`

### 4.6 Background Jobs (Hangfire)
- [x] Migrate `Infrastructure/BackgroundJobs/ChapterScrapingJob.cs` → `BackgroundJobs/ChapterScrapingJob.cs`
- [x] Migrate `Infrastructure/BackgroundJobs/MeiliSyncJob.cs` → `BackgroundJobs/MeiliSyncJob.cs`
- [x] Migrate `Infrastructure/BackgroundJobs/DeleteMangaJob.cs` → `BackgroundJobs/DeleteMangaJob.cs`
- [x] Migrate `Infrastructure/BackgroundJobs/LatestScrappingJob.cs` → `BackgroundJobs/LatestScrappingJob.cs`

### 4.7 Security
- [x] Migrate `Infrastructure/Security/CustomAuthSchemeOptions.cs` → `Security/CustomAuthSchemeOptions.cs`
- [x] Migrate `Infrastructure/Security/CustomAuthValidation.cs` → `Security/CustomAuthValidation.cs`
- [x] Migrate `Infrastructure/Security/HangfireAuthFillter.cs` → `Security/HangfireAuthFilter.cs` (fix typo)

### 4.8 Configuration Models
- [x] Migrate all `Infrastructure/Models/*.cs` settings POCOs → `Configuration/` folder:
  - `MongoSettings`, `ScrapperSettings`, `FlareSolverrSettings`, `MeiliConfig`, `QdrantConfig`, `EmbeddingConfig`, `DiscordWebhookSettings`, `DomainSettings`

### 4.9 DI Extension
- [x] Create `DependencyInjection/InfrastructureExtensions.cs` — `AddMangaScrapperInfrastructure(IServiceCollection, IConfiguration)`:
  - MongoDB client + context registration
  - Repository registrations
  - Hangfire MongoDB storage setup
  - HTTP client registrations (Scraper, Komiku, Kiryuu, Komikcast, MangaDex, FlareSolverr, ImageProxy, Discord)
  - External service registrations (Meili, Qdrant, StorageSync)
  - SemaphoreSlim (MaxParallelDownloads) singleton

---

## Phase 5 — MangaScrapper.Api (NEW PROJECT)

### 5.1 Project Setup
- [x] Create `src/Services/MangaScrapper/MangaScrapper.Api/MangaScrapper.Api.csproj`
- [x] Add references: `MangaScrapper.Application`, `MangaScrapper.Infrastructure`, `NovaStack.Infrastructure`
- [x] Add project to `MangaScrapperStack.sln`

### 5.2 Program.cs — Composition Root (Thin)
- [x] Wire `builder.Services.AddMangaScrapperApplication()`
- [x] Wire `builder.Services.AddMangaScrapperInfrastructure(builder.Configuration)`
- [x] Wire `builder.Services.AddMangaScrapperAuth(builder.Configuration)` (part of Infrastructure DI)
- [x] Wire `builder.Services.AddNovaStackObservability("MangaScrapper.Api")`
- [x] Wire `IEndpointDefinition` scanner
- [x] Map Hangfire dashboard (`/hangfire`)
- [x] Map static file serving (image storage path from config)
- [x] Map Swagger/OpenAPI
- [x] Add CORS middleware from config
- [x] Add Data Protection key persistence

### 5.3 Configuration & appsettings
- [x] Create `appsettings.json` with all sections: MongoDB, Scrapper, Meili, Qdrant, Embedding, FlareSolverr, Discord, Domain, Cors, Jwt
- [x] Create `appsettings.Development.json`
- [x] Copy `provider/` JSON scraping configs into project

### 5.4 Dockerfile
- [x] Update `Dockerfile` for multi-stage build (build from solution root, publish Api project)

---

## Phase 6 — Scrapper.Worker (NEW PROJECT)

### 6.1 Project Setup
- [x] Create `src/Workers/Scrapper.Worker/Scrapper.Worker.csproj`
- [x] Add references: `MangaScrapper.Infrastructure`
- [x] Add project to `MangaScrapperStack.sln`

### 6.2 Worker Host
- [x] Create `Program.cs` — hosted service with Hangfire server
- [x] Register all Hangfire background job classes as transient (`ChapterScrapingJob`, `MeiliSyncJob`, `DeleteMangaJob`, `LatestScrappingJob`)
- [x] Configure Hangfire MongoDB storage (same DB as Api)

---

## Phase 7 — Tests

### 7.1 UnitTests
- [x] Add project reference to `MangaScrapper.Application` and `MangaScrapper.Domain`
- [x] Add NuGet: `xUnit`, `Moq`, `FluentAssertions`
- [x] Write `Manga.Create_ValidArgs_RaisesCreatedEvent` test
- [x] Write `Manga.Reconstitute_DoesNotRaiseEvents` test
- [x] Write `GetPagedMangaQueryHandler_Returns_PagedList` test (mocked `IMangaRepository`)

### 7.3 ArchitectureTests
- [x] Add NuGet: `NetArchTest.Rules`
- [x] Write: `Domain_Should_Not_Reference_Application`
- [x] Write: `Domain_Should_Not_Reference_Infrastructure`
- [x] Write: `Application_Should_Not_Reference_Infrastructure`
- [x] Write: `Handlers_Should_Be_Sealed`
- [x] Write: `Endpoints_Should_Implement_IEndpointDefinition`

---

## Phase 8 — Solution Cleanup & Documentation

- [x] Integrate MangaScrapper projects into solution (`MangaScrapperStack.sln`)
- [x] Replace contracts with `NovaStack.Contracts` and Building Blocks
- [x] Run `dotnet build MangaScrapperStack.sln` → 0 errors
- [x] Run `dotnet test` for all test projects → 21/21 tests passing
