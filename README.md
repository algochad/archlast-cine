# Archlast Cine

A self-hosted streaming app for movies, series and anime — a cinematic web UI on top of a Rust media gateway, with
accounts that sync your list, watch progress and preferences across devices. Subtitles in 30+ languages for every title.

> Archlast Cine does not host or store any media. Streams are resolved from third-party sources at play time and proxied
> through your own server. Respect the laws of your country.

## Architecture

```
                       ┌────────────────────────── browser ──────────────────────────┐
                       │  Next.js app (apps/web)  ·  hls.js / dash.js player          │
                       └───────────┬──────────────────────────────┬──────────────────┘
                 /api/account/*    │                /api/mb/*  /api/proxy/*          │
                                   ▼                              ▼
                       ┌────────────────────┐        ┌──────────────────────────────┐
                       │ NestJS API         │        │ Rust media gateway           │
                       │ apps/api           │        │ services/media-gateway       │
                       │ Prisma · JWT       │        │ catalog · streams · subtitles│
                       └───────┬────────────┘        │ same-origin proxy · transcode│
                               ▼                     └───────┬───────────────┬──────┘
                       Postgres + Redis                      ▼               ▼
                                                  crates/media-engine   services/anime-resolver
                                                  (providers, subtitles)   (Go sidecar)
```

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 16 app: home, browse, search, title, player, account |
| `apps/api` | NestJS account API (auth, history, my list, settings) |
| `services/media-gateway` | Rust axum service — the only thing the web app talks to for media |
| `services/anime-resolver` | Go sidecar that resolves anime streams and soft subtitles |
| `crates/media-engine` | Rust provider engine (Collaps/Cinemeta, MovieBox, 4KHDHub, anime, subtitles) — vendored fork of `mesamirh/MovieBox-Tui` |
| `packages/contracts` | Types and constants shared by the web app and the API |
| `packages/tsconfig` | Shared TypeScript configs |

### How titles play

Metadata comes from **Cinemeta** (TMDB/IMDb aggregate, no API key) and streams from the **Collaps** CDN embed, both keyed
by IMDb id. If a title isn't there, the gateway transparently falls back to other catalogs. Subtitles from the stream, the
fallback source and the **OpenSubtitles** community catalog are merged into one list per language. Viewers never see any
source names — URLs look like `/title/tt1375666` and `/watch/tt0944947?s=3&e=5`.

## Getting started

Requirements: Node ≥ 20, Rust (stable, edition 2024), Docker (for Postgres/Redis). Go is optional (anime).

```sh
npm install
npm run infra:up      # Postgres + Redis (accounts)
npm run dev           # web :3000 · gateway :9797 · api :4100 · anime-resolver :9798
```

`npm run dev` runs every workspace's `dev` script through Turborepo; services that are already running (or whose
toolchain isn't installed) are skipped. Open http://localhost:3000.

| Command | Does |
| --- | --- |
| `npm run build` | Build everything (`turbo run build`) |
| `npm test` | Vitest (web, contracts) and `cargo test` (engine, gateway) |
| `npm run typecheck` | `tsc` for TS workspaces, `cargo check` for Rust |
| `npm run lint` | `cargo clippy` |
| `npx turbo run <task> --filter=@archlast/web` | Run a task in one workspace |

## Deploying (Coolify / any Docker host)

`docker-compose.yml` at the repo root is the production stack: `web` (Next + gateway on one origin), `api`, `scraper`
(anime resolver), Postgres and Redis. Expose only `web`.

Required variables: `POSTGRES_PASSWORD`, `JWT_SECRET`. Optional: `MOVIEBOX_PROXY_BASE` (leave empty for same-origin
relative URLs), `MOVIEBOX_REGION`, `WEB_PORT`.

```sh
docker compose up -d --build
```

Local hot-reload stack: `docker compose -f docker-compose.dev.yml up --build`.

## Contributing

See [`AGENTS.md`](AGENTS.md) for conventions, the design-system vocabulary and the end-to-end checks to run after touching
playback or subtitles.
