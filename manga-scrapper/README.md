# MangaScrapper

MangaScrapper is a comprehensive, production-grade full-stack solution for scraping, managing, and reading manga. Built using **Vertical Slice Architecture (VSA)** and **Domain-Driven Design (DDD)** in .NET 10, it features a robust backend where provider scrapers instantiate and return domain aggregates (`Manga`, `Chapter`, `Page`), store BSON documents in MongoDB, index full-text search in Meilisearch, vectorize recommendations in Qdrant, and orchestrate background jobs via Hangfire and RabbitMQ. The project includes a modern, high-performance Blazor WebAssembly admin panel for seamless management, user library tracking, and reading progression.

For the mobile-first reading experience, check out the [Open Manga Reader](https://github.com/Skyleaft/Open-Manga-Reader) client.

> **⚠️ License — Educational Purpose Only**
>
> This project is provided **strictly for educational and personal research purposes**. It is not intended for commercial use, redistribution, or deployment in any production environment that violates the terms of service of the scraped websites. The author assumes no responsibility for misuse.

---

## 🚀 Key Features

- **Multi-Source Scraping**: Provider-based design with Domain-Driven scraper services returning domain aggregates:
  - **Komiku** — Indonesian comics aggregator
  - **Kiryuu** — Popular Indonesian manga site
  - **Komikcast** — Indonesian manga platform
  - **MangaDex** — International manga database
- **Cloudflare Bypass**: Integrated **FlareSolverr** support for scraping Cloudflare-protected sites.
- **Playwright Automation**: Browser-based scraping with **Microsoft Playwright** for JavaScript-rendered pages.
- **Image Proxy**: Server-side image proxy that spoofs browser User-Agent headers to bypass hotlink protection.
- **Smart Search**: Typo-tolerant, lightning-fast full-text search powered by **Meilisearch**.
- **AI Vector Search & Recommendations**: Advanced vector operations powered by **Qdrant** and in-process ONNX embeddings (`onnx-community/Qwen3-Embedding-0.6B-ONNX`):
  - **Multilingual Semantic Search**: Search manga using natural language across 100+ languages (e.g., Bahasa Indonesia queries like *"reinkarnasi ke dunia lain punya banyak istri"*).
  - **Vector Similarity Search**: Find semantically similar manga based on content embeddings with support for status, type, and genre payload filters.
  - **Preference Recommendations**: Centroid-based history recommendations and advanced multi-item recommendations using native positive (liked) and negative (disliked) example vector arithmetic.
- **Smart Background Processing**: Integration with **Hangfire** (MongoDB storage) for reliable background scraping jobs and recurring sync tasks.
- **Event Bus Messaging & Real-Time SignalR**: Native **RabbitMQ** event bus integration coupled with **ASP.NET Core SignalR** (`/hubs/manga`) for:
  - **Live Scraping Progress Streaming**: Incremental page-by-page progress bars and metrics (`ChapterScrapingProgress`) streamed in real-time as `Scrapper.Worker` downloads and converts pages.
  - **Instant Chapter Update Broadcasts**: Real-time chapter completion events (`ChaptersUpdated`) triggering automatic client refreshes without full-page reloads.
- **Firebase Cloud Messaging (FCM)**: Push notification integration for Flutter mobile clients (`Open-Manga-Reader`) delivering instant new chapter notifications to users based on their bookmarked `UserLibrary` and topic subscriptions (`manga_{mangaId}`).
- **Discord Notifications**: Webhook-based Discord notifications for scraping events and job completions.
- **User Library & Progression**: Track per-user manga libraries and reading progression (chapter-level tracking) backed by custom auth and Firebase authentication.
- **Admin Dashboard**: Real-time statistics, monthly scrap charts, and recent activity monitoring.
- **Advanced Management**:
  - Dynamic manga list with pagination, multi-genre filtering, and advanced sorting.
  - Interactive Manga Detail Modal with live gradient scraping progress bars, animated status badges, metadata editing, and chapter management.
  - Manual `TotalView` overrides and chapter availability indicators.
- **Optimized Storage**: Automatic image conversion using **SkiaSharp** and centralized local storage with optional sync service.
- **Observability**: Full **OpenTelemetry** integration with Prometheus metrics scraping (`/metrics`), OTLP trace/metric/log export, and runtime instrumentation.

---

## 🛠️ Technical Stack

### Backend Architecture

- **Runtime & Language**: .NET 10.0, C# 13.0
- **Architectural Style**: **Vertical Slice Architecture (VSA)** & **Domain-Driven Design (DDD)** — Unified Two-Tier Structure (`MangaScrapper.Core` + Thin Host Executables)
- **CQRS & Mediator**: MediatR 14 (with logging and validation pipeline behaviors)
- **APIs & Real-Time**: ASP.NET Core Minimal APIs with reflection-based endpoint discovery (`IEndpointDefinition`) & **SignalR** Hubs (`MangaHub`)
- **Push Notifications**: **Firebase Admin .NET SDK** (`FirebaseAdmin.Messaging`) for real-time FCM multicast and topic broadcasts
- **Database & Persistence**: MongoDB 8 via `MongoDB.Driver` 3.x, Meilisearch 0.17 (full-text search), Qdrant 1.13 (vector search)
- **Domain Aggregates**: Centralized domain aggregates (`Manga`, `Chapter`, `Page`) produced directly by provider scrapers and mapped transparently to BSON documents for MongoDB persistence.
- **Identifier Generation**: Standardized on UUIDv7 (`Guid.CreateVersion7()`) for sequential, time-sortable database identifiers to improve index locality.
- **Object Mapping**: Mapster 10.x (centralized in `MangaMappingConfig.cs` and `MangaInfrastructureMapping.cs`)
- **Validation**: FluentValidation 12
- **Error Handling**: Railway-oriented `Result<T>` and `Error` types (no domain exceptions for control flow)
- **Background Jobs**: Hangfire 1.8 with MongoDB Storage (`Hangfire.Mongo`)
- **Messaging & Event Bus**: Native RabbitMQ EventBus (`NovaStack.Infrastructure`) & Integration Event Handlers
- **Scrapers & Helpers**: HtmlAgilityPack, Microsoft Playwright, FlareSolverr HTTP client, SkiaSharp image processing

### Frontend & Mobile Clients

- **Blazor WebAssembly** (.NET 10) — Admin Web Client
- **Flutter Mobile Client** (`Open-Manga-Reader`) — Multiplatform Reader App consuming FCM new chapter push notifications
- **Microsoft.AspNetCore.SignalR.Client** for live scraping progress bars and real-time updates
- **Blazored.LocalStorage** for client-side state persistence
- **Cookie Handler** for transparent cookie forwarding from WASM to the API
- **JWT / Custom Auth State Provider** for Blazor auth integration
- **Tailwind CSS** for modern, responsive UI
- **Lucide Icons** & Glassmorphic design system

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
│   │   │   ├── Domain/                    # Domain Aggregates (Manga, Chapter, Page, Value Objects, Domain Events)
│   │   │   ├── Scrapers/                  # Provider Scrapers producing Domain Aggregates (Komiku, Kiryuu, Komikcast, MangaDex)
│   │   │   ├── Persistence/               # Mongo DbContext, BSON Document schemas (MangaDocument, UserDocument, etc.)
│   │   │   ├── Repositories/              # MongoMangaRepository, MongoUserRepository, MongoUserLibraryRepository
│   │   │   ├── Services/                  # MeilisearchService, QdrantService, DiscordWebhookService, StorageSyncService, FcmNotificationService
│   │   │   ├── Hubs/                      # SignalR Real-Time Hubs (MangaHub)
│   │   │   ├── BackgroundJobs/            # Hangfire background jobs (MeiliSyncJob, DeleteMangaJob, LatestChapterScrapingJob)
│   │   │   ├── Messaging/                 # RabbitMQ handlers (ScrapChapterPagesHandler, ChapterPagesScrapedSignalRHandler, ChapterScrapingProgressSignalRHandler, DeleteMangaHandler)
│   │   │   ├── Security/                  # Custom Auth validation & JwtAuthTokenService
│   │   │   └── DependencyInjection/       # CoreExtensions (AddMangaScrapperCore & MapMangaScrapperEndpoints)
│   │   │
│   │   ├── MangaScrapper.Api/             # Thin Web API Host entry point (Program.cs, Swagger/Scalar, Auth, SignalR Hubs)
│   │   └── MangaPanel.Client/             # Blazor WebAssembly Frontend Client (SignalR Client, Live Progress Bar)
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
└── docker-compose.yml                     # Multi-container local orchestration
```

---

## 📡 AsyncAPI & Real-Time Specifications

The asynchronous messaging architecture, SignalR WebSockets channels, and Firebase Cloud Messaging push notifications are formally documented using standard **AsyncAPI 3.0.0**:

- **Specification File**: [`asyncapi.yaml`](file:///e:/repo/cs/MangaScrapper-VSlice/asyncapi.yaml)
- **Servers**:
  - **RabbitMQ** (`amqp://localhost:5672`): Scraping queues, file cleanup, storage & database synchronization.
  - **SignalR Hub** (`wss://localhost:5000/hubs/manga`): Live chapter scraping progress streaming (`ChapterScrapingProgress`) & chapter refresh broadcasts (`ChaptersUpdated`).
  - **FCM Gateway** (`https://fcm.googleapis.com`): Mobile push notifications for Flutter client (`Open-Manga-Reader`).

---

## ⚙️ Configuration

Main configuration is defined in `appsettings.json` within `MangaScrapper.Api` and `Scrapper.Worker`:

```json
{
  "MongoDB": {
    "ConnectionString": "mongodb://localhost:27017",
    "DatabaseName": "manga-scrap"
  },
  "Scrapper": {
    "MaxParallelDownloads": 10,
    "ImageStoragePath": "images"
  },
  "Meili": {
    "Host": "http://localhost:7700",
    "ApiKey": "your_meilisearch_key"
  },
  "Qdrant": {
    "Host": "localhost",
    "Port": 6334
  },
  "Embedding": {
    "ModelPath": "models/qwen3-embedding-0.6b/model.onnx",
    "TokenizerPath": "models/qwen3-embedding-0.6b/tokenizer.json",
    "VectorSize": 1024,
    "ExecutionProvider": "CPU"
  },
  "FlareSolverr": {
    "Host": "http://localhost:8191"
  },
  "Discord": {
    "WebhookUrl": "https://discord.com/api/webhooks/..."
  },
  "Domain": {
    "BaseUrl": "http://localhost:5191"
  },
  "Cors": {
    "AllowedOrigins": ["http://localhost:3000", "http://localhost:5191"],
    "AllowCredentials": true
  }
}
```

---

## 🏁 Getting Started

### Prerequisites

- **.NET 10 SDK**
- **MongoDB Server**
- (Optional) Meilisearch, Qdrant, FlareSolverr, RabbitMQ

### Local Building & Execution

1. **Clone the repository**
2. **Build the solution**:
   ```powershell
   dotnet build MangaScrapperStack.sln
   ```
3. **Run Unit & Architecture Tests**:
   ```powershell
   dotnet test tests/UnitTests/UnitTests.csproj
   dotnet test tests/ArchitectureTests/ArchitectureTests.csproj
   ```
4. **Run the API Host**:
   ```powershell
   dotnet run --project src/Services/MangaScrapper/MangaScrapper.Api/MangaScrapper.Api.csproj
   ```
5. **Run the Background Worker Host**:
   ```powershell
   dotnet run --project src/Workers/Scrapper.Worker/Scrapper.Worker.csproj
   ```

### 🐳 Docker Compose

Run the entire infrastructure stack using Docker Compose:

```bash
docker-compose up -d --build
```

#### Available Endpoints
- **Web API / Admin Panel**: `http://localhost:5191`
- **Scalar API Reference**: `http://localhost:5191/scalar/v1`
- **Hangfire Dashboard**: `http://localhost:5191/hangfire`
- **Prometheus Metrics**: `http://localhost:5191/metrics`
- **Meilisearch**: `http://localhost:7700`
- **Qdrant**: `http://localhost:6333`
- **FlareSolverr**: `http://localhost:8191`

---

## 📜 License

This project is intended **for educational purposes only**.

- ✅ You may study, fork, and modify this code for learning.
- ❌ You may **not** use it commercially or in violation of any third-party website's Terms of Service.
- ❌ You may **not** redistribute scraped content or deploy it as a public service.

---
*© 2026 MangaScrapper Engine v3.0 (Vertical Slice Architecture)*
