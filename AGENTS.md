# Repository Guidelines

> Next.js rules live next to the app: read `apps/web/AGENTS.md` (written by `next dev`) and the guides in
> `node_modules/next/dist/docs/` before changing App Router code. This Next.js has breaking changes.

## Project Overview

Archlast Cine is a self-hosted streaming platform. A Next.js web app browses and plays movies, series and anime through a
Rust media gateway, with accounts (list, watch progress, settings) synced via a NestJS API. It hosts no media; streams
resolve from third-party sources and every stream byte is proxied same-origin. **Viewers never see which source a title
came from**: URLs, labels and filters are source-agnostic.

Turborepo monorepo (npm workspaces):

```
apps/
  web/              Next.js 16 app (React 19, Tailwind v4)            @archlast/web
  api/              NestJS account API (Prisma + Postgres + Redis)    @archlast/api
services/
  media-gateway/    Rust (axum) gateway: catalog, streams, subtitles, proxy, transcode   @archlast/media-gateway
  anime-resolver/   Go sidecar resolving anime streams + soft subs    @archlast/anime-resolver
crates/
  media-engine/     Rust provider engine + TUI (crate `moviebox-tui`, vendored fork)     @archlast/media-engine
packages/
  contracts/        Shared TS contracts (account/settings/history/list)  @archlast/contracts
  tsconfig/         Shared tsconfig bases                                @archlast/tsconfig
scripts/            dev-service.mjs: launcher used by every `dev` script
docs/               design notes and plans
```

## Architecture & Data Flow

- Web: browser → Next App Router (`apps/web/src/app`) → same-origin route handlers (`/api/mb/*` → gateway, `/api/account/*` → Nest, `/api/proxy/*` → gateway media proxy) → Postgres + Redis (accounts) or upstream CDNs (media).
- **Catalog & playback source of truth:** the gateway's `collaps` provider (`crates/media-engine/src/providers/collaps/`): metadata from Cinemeta (keyless TMDB/IMDb aggregate), streams + soft subtitles scraped from the Collaps embed, all keyed by IMDb id. Titles Collaps lacks fall back to MovieBox/4KHDHub transparently (`service/unified.rs`).
- **Subtitles for every source:** `MovieBoxService::captions_for` (engine `service/unified.rs`) merges each source's native tracks with the Stremio OpenSubtitles addon (keyed by IMDb id, mapped from title/year for non-IMDb sources). Web: `lib/sub-menu.ts` groups by language and auto-picks; `components/subtitle-list.tsx` renders the CC menu.
- **Provider-free URLs:** `apps/web/src/lib/title-ref.ts` encodes `(provider,id)` into one opaque ref (`/title/tt1375666`, `/watch/m-123?s=1&e=2`). Legacy `/title/<provider>/<id>` routes redirect. Never render provider names in the UI.
- Media proxy: tickets minted by the gateway (`/api/proxy/ticket`); playlists are rewritten so segments stay on `/api/proxy/…`; foreign hosts become tickets of their own. DNS resolution (`crates/media-engine/src/net.rs`) falls back resolver → getaddrinfo → public DNS → last-known-good, because Docker's embedded DNS fails for some CDN hosts.
- Account flow: `lib/api-account.ts` → `/api/account/*` handlers (httpOnly `mb_token` cookie) → Nest `auth`/`users`/`history`/`my-list` → Prisma. The client never sees a JWT. Shared shapes live in `@archlast/contracts`.
- Session state: `lib/session.tsx` (three contexts, contract in `lib/session-contract.ts`).
- `MOVIEBOX_PROXY_BASE` (gateway) is the public origin used to rewrite manifests; leave it empty for same-origin relative URLs.

## Development Commands (run from the repo root)

```sh
npm install                 # installs every workspace
npm run dev                 # turbo: web :3000, gateway :9797, api :4100, anime-resolver :9798 (skips running/missing ones)
npm run infra:up            # Postgres + Redis for the API (docker compose)
npm run build               # turbo build (contracts → api/web/gateway)
npm run typecheck           # tsc for TS workspaces, cargo check for Rust
npm test                    # vitest (web, contracts) + cargo test (engine, gateway)
npm run lint                # cargo clippy
npx turbo run test --filter=@archlast/web     # one workspace
docker compose up --build   # production stack (Coolify uses docker-compose.yml)
```

- Dockerfiles live beside what they build (`apps/web`, `apps/api`, `services/anime-resolver`) and build from the repo root. The web image bundles the gateway and Next on one origin.
- Rust: `cargo fmt --check`, `cargo clippy` inside `crates/media-engine` / `services/media-gateway`. `services/media-gateway/src/main.rs` is not rustfmt-clean (pre-existing); format only files you author.
- Go is not required locally; `anime-resolver` dev/test scripts skip when `go` is missing. Docker builds it.

## Code Conventions

- TypeScript strict; path alias `@/*` → `apps/web/src/*`; kebab-case files, PascalCase components, camelCase functions. Shared TS config comes from `@archlast/tsconfig`.
- Design system: tokens in `apps/web/src/app/globals.css` (`@theme`: ink (true black) / surface / brand emerald green + mint, Outfit display + DM Sans). Utilities: `.btn-solid/.btn-glass/.btn-ghost`, `.chip`, `.glass`, `.poster`, `.field`, `.page-shell`, `.display-title`, `.section-title`. Prefer these over ad-hoc styles.
- Frontend client pattern (`lib/api.ts`): typed `request<T>()`, `ApiError` with `.status`, always `encodeURIComponent` query params.
- Server components call the gateway through `lib/server-api.ts` (`backendJson`), never raw `fetch` with hard-coded URLs.
- Nest: constructor DI, DTOs validated by the global pipe, errors via Nest built-ins. Account types come from `@archlast/contracts` (re-exported by `apps/api/src/common/account.types.ts`).
- Rust: new provider code goes in `crates/media-engine/src/providers/`; HTTP surface in `services/media-gateway/src/main.rs`. Add unit tests for pure logic.

## Testing & QA

- Web: Vitest 5 + jsdom, tests in `apps/web/src/**/__tests__/`; one `describe` per function, dense boundary cases; component behavior tested headlessly against `lib` helpers (no DOM mounting).
- Contracts: Vitest. Rust: `cargo test` (engine ≈ 330 tests, gateway). API/anime-resolver have no tests.
- End-to-end checks that matter after touching playback/subtitles: run the stack, then drive a real browser (headless Chromium with `--autoplay-policy=no-user-gesture-required`) through `/watch/<ref>` and confirm video advances, English audio is selected, and a known cue renders after a seek.

## Environment

- Node ≥ 20 (Docker: `node:22-slim`), npm workspaces + one root `package-lock.json`. Do not introduce pnpm/Bun.
- Rust edition 2024 (Docker: `rust:1.97-bookworm`). Go 1.22 for the anime resolver.
- Env knobs: `CINEMETA_BASE_URL` / `COLLAPS_EMBED_BASE_URL` (catalog + stream upstreams), `MB_BACKEND_URL`, `MOVIEBOX_SERVER_PORT`, `MOVIEBOX_PROXY_BASE`, `ANIME_SIDECAR_URL`, `API_URL`, `API_PORT`/`API_HOST`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`/`JWT_TTL`, `PRISMA_AUTO_PUSH`, `*_HOST_PORT` overrides in `.env`.
