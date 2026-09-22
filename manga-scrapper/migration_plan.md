# MangaScrapper → NovaStack VSA Migration Plan

## Background

The current `MangaScrapper` project is a monolithic ASP.NET Core application that combines:
- Blazor Server (WASM host) for the admin panel (`MangaPanel.Client`)
- FastEndpoints-based REST API
- All features co-located in a single project under `Features/`
- Infrastructure (repositories, Mongo context, jobs) mixed into the same project
- Shared DTOs in a `MangaScrapper.Shared` project

The target **NovaStack** architecture (`MangaScrapperStack.sln`) applies:
- **Vertical Slice Architecture (VSA)** via MediatR 14 + CQRS
- **Clean separation** into `Domain`, `Application`, `Infrastructure`, and `Api` layers per bounded context
- **BuildingBlocks** shared kernel (`NovaStack.SharedKernel`, `NovaStack.Infrastructure`, `NovaStack.Contracts`)
- **Worker services** (`Scrapper.Worker`) for Hangfire background job processing
- **Minimal APIs** via `IEndpointDefinition` scanner (replacing FastEndpoints)
- **Railway-oriented** `Result<T>` / `Error` error handling (no thrown domain exceptions)
- **MongoDB native driver** branch (no EF Core, no UoW/SQL factory)

---

## Confirmed Decisions

| # | Decision | Answer |
|---|---|---|
| Q1 | Scraper provider scope | ✅ **Single application** — all scraper providers (Komiku, Kiryuu, Komikcast, MangaDex) remain as vertical slices within `MangaScrapper.Application/Features/` |
| Q2 | Blazor Panel placement | ✅ **Co-hosted** — `MangaPanel.Client` (Blazor WASM) stays co-hosted inside `MangaScrapper.Api` |
| Q3 | Hangfire vs Worker Services | ✅ **Keep Hangfire** — Hangfire is retained for job orchestration (retry, queue, dashboard). A dedicated `Scrapper.Worker` project hosts the Hangfire server process |
| Q4 | Firebase Auth | 🔵 *Assumed retained* — Firebase Admin SDK kept for mobile client auth; admin auth uses local Argon2 + JWT. `Identity.*` projects not added in this migration |
| Q5 | Messaging broker | 🔵 *Assumed none* — No RabbitMQ/Kafka added. Discord notifications stay as direct HTTP webhook calls |

---

## Proposed Changes

The solution target layout mirrors the `.sln` but renamed for MangaScrapper context:

```
NewArchitecture/src/
├── BuildingBlocks/
│   ├── NovaStack.SharedKernel/      (already exists — no change)
│   ├── NovaStack.Infrastructure/    (already exists — extend with Hangfire, Scraper HTTP configs)
│   └── NovaStack.Contracts/         (already exists — add MangaScrapper DTOs/responses)
│
└── Services/
    └── MangaScrapper/               (rename from Product → MangaScrapper)
        ├── MangaScrapper.Domain/    (Manga aggregate, Chapter VO, UserLibrary, UserProgression aggregates)
        ├── MangaScrapper.Application/ (VSA features, MediatR handlers, validators, endpoint defs)
        ├── MangaScrapper.Infrastructure/ (MongoDbContext, Repositories, Hangfire jobs, Scraper services)
        └── MangaScrapper.Api/       (Composition root: Program.cs, Blazor WASM host, config, Dockerfile)

Workers/
└── Scrapper.Worker/                 (Hangfire server host + background job classes)

tests/
├── UnitTests/
├── IntegrationTests/
└── ArchitectureTests/
```

---

### Phase 1 — BuildingBlocks (Foundation)

#### [MODIFY] NovaStack.SharedKernel

Add MangaScrapper-specific shared types that belong in the kernel:
- `Guard` extension for collection/range validation
- Any missing `IEntity<TId>`, `IAggregateRoot`, `IHasDomainEvents` if not present

#### [MODIFY] NovaStack.Infrastructure

Extend with infrastructure needed for MangaScrapper:
- `Persistence/MongoDb/` — `IMongoDbContext` / `MongoDbContextBase` (verify already present, extend if needed)
- `Observability/` — OpenTelemetry wiring helpers (move from `Program.cs` monolith)
- `Authentication/` — Cookie + CustomAuth scheme helpers (move from `Program.cs`)
- `Http/` — `HttpConfig` (client factory helpers: FlareSolverr, Scraper UA spoofing, ImageProxy)

#### [MODIFY] NovaStack.Contracts

Add shared contract DTOs replacing `MangaScrapper.Shared`:
- `ApiResponse<T>` wrapper (already exists in template)
- Integration event shapes (placeholder, not wired yet)
- Shared response records: `MangaSummaryResponse`, `ChapterResponse`, `UserLibraryResponse`, `UserProgressionResponse`

---

### Phase 2 — MangaScrapper.Domain

#### [NEW] MangaScrapper.Domain.csproj

Domain layer — no framework dependencies except `NovaStack.SharedKernel`.

**Aggregates:**
- `MangaAggregate` — `Manga` entity with `Chapters`, `Genres`, `Status`, `Source`
- `UserLibraryAggregate` — `UserLibrary` (userId + mangaId bookmark)
- `UserProgressionAggregate` — `UserProgression` (userId + mangaId + last chapter read)

**Value Objects:**
- `MangaId`, `ChapterId`, `UserId`
- `MangaSource` (enum: Komiku, Kiryuu, Komikcast, MangaDex)
- `MangaStatus` (enum: Ongoing, Completed, Hiatus)

**Repository Interfaces (moved from Infrastructure):**
- `IMangaRepository`
- `IUserLibraryRepository`
- `IUserProgressionRepository`

**Domain Events (new):**
- `MangaCreatedDomainEvent`
- `ChapterScrapedDomainEvent`
- `UserLibraryUpdatedDomainEvent`

---

### Phase 3 — MangaScrapper.Application

#### [NEW] MangaScrapper.Application.csproj

Application layer — depends on `Domain` and `NovaStack.SharedKernel`.

Uses MediatR 14, FluentValidation 12, Mapster.

**Feature Slices (one folder per operation):**

##### `Features/Manga/`
- `GetPagedManga/` — Query + Handler + Validator + Endpoint (`GET /api/v1/manga`)
- `GetMangaById/` — Query + Handler + Endpoint (`GET /api/v1/manga/{id}`)
- `GetAllChapters/` — Query + Handler + Endpoint
- `GetChaptersPage/` — Query + Handler + Endpoint
- `GetAllGenre/` — Query + Handler + Endpoint
- `GetAllType/` — Query + Handler + Endpoint
- `GetTrending/` — Query + Handler + Endpoint
- `GetRecommendations/` — Query (delegates to Qdrant service) + Endpoint
- `UpdateManga/` — Command + Handler + Validator + Endpoint
- `DeleteManga/` — Command + Handler + Endpoint
- `DeleteChapter/` — Command + Handler + Endpoint
- `SyncMeili/` — Command + Handler + Endpoint (trigger Meilisearch sync)
- `SyncQdrant/` — Command + Handler + Endpoint (trigger Qdrant sync)

##### `Features/Scrapper/`
- `ScrapChapterPages/` — Command + Handler + Endpoint (queue Hangfire job)
- `SearchJikan/` — Query + Handler + Endpoint (Jikan API lookup)
- `UpdateMangaMetaData/` — Command + Handler + Endpoint
- `GetAllProvider/` — Query + Handler + Endpoint
- `GetQueue/` — Query + Handler + Endpoint (Hangfire queue status)
- `ClearQueueErrors/` — Command + Handler + Endpoint
- `FixFile/` — Command + Handler + Endpoint
- `FixLanguage/` — Command + Handler + Endpoint

##### `Features/ScrapperKomiku/`
- `GetDetail/` — Query + Handler + Endpoint
- `ScrapManga/` — Command + Handler + Endpoint
- `Search/` — Query + Handler + Endpoint

##### `Features/ScrapperKiryuu/`
- Mirror of Komiku slice structure

##### `Features/ScrapperKomikcast/`
- Mirror of Komiku slice structure

##### `Features/ScrapperMangadex/`
- Mirror of Komiku slice structure

##### `Features/Auth/`
- `Login/` — Command + Handler + Validator + Endpoint
- `Logout/` — Command + Handler + Endpoint
- `Register/` — Command + Handler + Validator + Endpoint
- `UserInfo/` — Query + Handler + Endpoint
- `FirebaseVerify/` — Command + Handler + Endpoint

##### `Features/Dashboard/`
- `GetStatistics/` — Query + Handler + Endpoint
- `SyncStorage/` — Command + Handler + Endpoint

##### `Features/RecurringJobs/`
- `CreateOrUpdateRecurringJob/` — Command + Handler + Endpoint
- `DeleteRecurringJob/` — Command + Handler + Endpoint
- `GetRecurringJobs/` — Query + Handler + Endpoint
- `TriggerRecurringJob/` — Command + Handler + Endpoint

##### `Features/UserLibrary/`
- `AddOrUpdateUserLibrary/` — Command + Handler + Validator + Endpoint
- `GetUserLibrary/` — Query + Handler + Endpoint
- `RemoveUserLibrary/` — Command + Handler + Endpoint

##### `Features/UserProgression/`
- `UpdateUserProgression/` — Command + Handler + Validator + Endpoint
- `GetUserProgression/` — Query + Handler + Endpoint
- `GetMangaProgression/` — Query + Handler + Endpoint

##### `Features/Images/`
- `ProxyImage/` — Query + Handler + Endpoint (image proxy pass-through)

**Common Abstractions:**
- `ICommand<T>`, `ICommand`, `IQuery<T>`, `ICommandHandler<,>`, `IQueryHandler<,>` (pipeline wrappers for MediatR)
- `ValidationBehavior<,>`, `LoggingBehavior<,>` pipeline behaviors

---

### Phase 4 — MangaScrapper.Infrastructure

#### [NEW] MangaScrapper.Infrastructure.csproj

Infrastructure layer — implements domain interfaces, depends on `NovaStack.Infrastructure`.

**Persistence:**
- `MangaMongoDbContext` — extends `MongoDbContextBase`
  - `Mangas`, `UserLibraries`, `UserProgressions`, `Users` collections
  - Index creation on startup (unique Title, composite UserId+MangaId)
- `MangaDocument`, `UserLibraryDocument`, `UserProgressionDocument`, `UserDocument` POCO classes
- `MongoMangaRepository`, `MongoUserLibraryRepository`, `MongoUserProgressionRepository`

**External Services (moved from `Infrastructure/Services/`):**
- `MeilisearchService` — Meilisearch sync
- `QdrantService` — Qdrant vector upsert
- `StorageSyncService` — local image storage sync
- `FlareSolverrService` — Cloudflare bypass HTTP client
- `DiscordWebhookService` — Discord notifications

**Scraper HTTP Clients:**
- `ScrapperService` (generic base scraper)
- `KomikuService`, `KiryuuService`, `KomikcastService`, `MangaDexService`
- `ImageProxyHttpClient` config

**Background Jobs (Hangfire):**
- `ChapterScrapingJob`
- `MeiliSyncJob`
- `DeleteMangaJob`
- `LatestScrappingJob`

**Security:**
- `CustomAuthSchemeOptions`, `CustomAuthValidation`
- `HangfireAuthFilter`
- Argon2 password hashing helper

**DI Extension:**
- `InfrastructureExtensions.AddMangaScrapperInfrastructure(...)` — registers all services

---

### Phase 5 — MangaScrapper.Api

#### [NEW] MangaScrapper.Api.csproj

Composition root. Thin `Program.cs` using extension methods.

- Hosts `MangaPanel.Client` (Blazor WASM) — co-hosted
- Registers all services via `AddMangaScrapperInfrastructure()` and `AddMangaScrapperApplication()`
- Wires `IEndpointDefinition` scanner for all feature endpoints
- Static file serving (image storage)
- Hangfire dashboard (`/hangfire`)
- OpenTelemetry (moved from monolith `Program.cs`)
- CORS, Cookie Auth, Data Protection setup
- MongoDB index bootstrap on startup

---

### Phase 6 — Scrapper.Worker

#### [NEW] Scrapper.Worker.csproj

Background worker host — runs Hangfire server.

- References `MangaScrapper.Infrastructure` (for job classes)
- Registers `IHostedService` Hangfire server
- Handles job retries, schedules

---

### Phase 7 — Tests

#### [MODIFY] UnitTests

- Unit tests for Domain aggregates (Manga.Create, UserLibrary, UserProgression)
- Unit tests for Application handlers (mocked repositories via Moq)
- Unit tests for validators (FluentValidation)

#### [MODIFY] IntegrationTests

- API integration tests using `WebApplicationFactory` + MongoDB Testcontainers
- Cover key endpoints: GetPagedManga, Login, UserLibrary CRUD, Scrap trigger

#### [MODIFY] ArchitectureTests

- NetArchTest rules:
  - `Domain` must not reference `Application` or `Infrastructure`
  - `Application` must not reference `Infrastructure`
  - All handlers must be `internal sealed`
  - Endpoints must implement `IEndpointDefinition`

---

## Verification Plan

### Automated Tests
```bash
dotnet build NewArchitecture/MangaScrapperStack.sln
dotnet test tests/UnitTests
dotnet test tests/ArchitectureTests
dotnet test tests/IntegrationTests
```

### Manual Verification
- Start MongoDB + Meilisearch + Qdrant via docker-compose
- `dotnet run --project src/Services/MangaScrapper/MangaScrapper.Api`
- Verify Swagger UI at `/swagger`
- Verify Hangfire dashboard at `/hangfire`
- Verify Blazor admin panel at `/`
- Test scraper endpoint and confirm Hangfire job creation
- Test user library add/remove via API

---

## Migration Mapping Reference

| Old Location | New Location |
|---|---|
| `MangaScrapper/Features/Manga/*` | `MangaScrapper.Application/Features/Manga/*` |
| `MangaScrapper/Features/Auth/*` | `MangaScrapper.Application/Features/Auth/*` |
| `MangaScrapper/Features/Scrapper/*` | `MangaScrapper.Application/Features/Scrapper/*` |
| `MangaScrapper/Features/ScrapperKomiku/*` | `MangaScrapper.Application/Features/ScrapperKomiku/*` |
| `MangaScrapper/Features/ScrapperKiryuu/*` | `MangaScrapper.Application/Features/ScrapperKiryuu/*` |
| `MangaScrapper/Features/ScrapperKomikcast/*` | `MangaScrapper.Application/Features/ScrapperKomikcast/*` |
| `MangaScrapper/Features/ScrapperMangadex/*` | `MangaScrapper.Application/Features/ScrapperMangadex/*` |
| `MangaScrapper/Features/Dashboard/*` | `MangaScrapper.Application/Features/Dashboard/*` |
| `MangaScrapper/Features/RecurringJobs/*` | `MangaScrapper.Application/Features/RecurringJobs/*` |
| `MangaScrapper/Features/UserLibrary/*` | `MangaScrapper.Application/Features/UserLibrary/*` |
| `MangaScrapper/Features/UserProgression/*` | `MangaScrapper.Application/Features/UserProgression/*` |
| `MangaScrapper/Features/Images/*` | `MangaScrapper.Application/Features/Images/*` |
| `MangaScrapper/Infrastructure/Mongo/*` | `MangaScrapper.Infrastructure/Persistence/` |
| `MangaScrapper/Infrastructure/Repositories/*` | `MangaScrapper.Domain/Repositories/` (interfaces) + `MangaScrapper.Infrastructure/Repositories/` (implementations) |
| `MangaScrapper/Infrastructure/BackgroundJobs/*` | `MangaScrapper.Infrastructure/BackgroundJobs/` + `Scrapper.Worker/` |
| `MangaScrapper/Infrastructure/Services/*` | `MangaScrapper.Infrastructure/Services/` |
| `MangaScrapper/Infrastructure/Security/*` | `MangaScrapper.Infrastructure/Security/` |
| `MangaScrapper/Infrastructure/Models/*` | `MangaScrapper.Infrastructure/Configuration/` |
| `MangaScrapper/Infrastructure/Utils/*` | `NovaStack.Infrastructure/Http/` or `MangaScrapper.Infrastructure/Http/` |
| `MangaScrapper.Shared/Models/*` | `NovaStack.Contracts/Responses/` (shared DTOs) |
| `MangaScrapper/Program.cs` (monolith DI) | Split across `AddMangaScrapperInfrastructure()`, `AddMangaScrapperApplication()`, `MangaScrapper.Api/Program.cs` |
| FastEndpoints handlers | `IEndpointDefinition` implementations + MediatR `ICommand`/`IQuery` handlers |
