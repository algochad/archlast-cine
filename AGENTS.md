<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository Guidelines

## Project Overview

Archlast Cine is a self-hosted streaming web app. A Next.js front end browses/plays movies, series, and manga through a Rust media backend, with accounts (list, watch/reading progress, settings) synced via a NestJS API. It hosts no media; streams resolve from third-party sources and every stream byte is proxied same-origin.

Polyglot monorepo: Next.js web (root), NestJS account API (`api/`), Rust media backend (`MovieBox-Tui/server/`, additive crate on a fork of upstream `mesamirh/MovieBox-Tui`), .NET manga stack (`manga-scrapper/`), Go/Node anime-scraper sidecar (`scripts/anime-scraper/`).

## Architecture & Data Flow

- Web request flow: browser → Next App Router (`src/app/`) → same-origin route handlers (`src/app/api/mb/*`, `src/app/api/account/*`) → Rust backend (`MB_BACKEND_URL`, default `http://127.0.0.1:9797`) or Nest API (`API_PORT`, default `4100`) → Postgres + Redis.
- Media proxy: `next.config.ts` rewrites `/api/proxy/:ticket` → backend; frontend helper `mbUrl()` in `src/lib/api.ts` maps backend `/api/*` paths to `/api/mb/*` so Range/DASH traffic stays same-origin.
- Account flow: `src/lib/api-account.ts` → `/api/account/*` handlers (own httpOnly `mb_token` cookie) → Nest `auth`/`users`/`history`/`reading-history`/`my-list` modules → Prisma (Postgres) + Redis (token denylist, login rate limit). Client never sees a JWT.
- Session state: `src/lib/session.tsx` exposes three React contexts (`Session`/`MyList`/`History`) implementing the contract in `src/lib/session-contract.ts`; region mirrored in readable `mb_region` cookie.
- Nest bootstrap (`api/src/main.ts`): global `ValidationPipe({ transform: true, whitelist: true })`, shutdown hooks, dev-secret warning in production. Auth issues `{ ...toAccountState(user), accessToken }` with `sub/email/jti`.
- Rust server (`MovieBox-Tui/server/src/main.rs`, axum + tokio): headless HTTP over the `moviebox-tui` crate; `MOVIEBOX_PROXY_BASE` must be the externally visible origin so DASH manifests survive the reverse proxy.

## Key Directories

- `src/app/` — App Router pages: `page.tsx` (home), `watch/[provider]/`, `title/[provider]/`, `search/`, `read/[provider]/`, `login/`, `signup/`, `account/`, `mylist/`, `history/`, plus `api/mb/` and `api/account/` proxies.
- `src/components/` — UI: `watch-player.tsx` (~88KB player), `title-card.tsx`, `title-detail.tsx`, `home-feed.tsx`, `title-row.tsx`, `billboard.tsx`, `nav.tsx`, `cover.tsx`, `icons.tsx`; behavior tests in `__tests__/`.
- `src/lib/` — pure logic + clients: `api.ts` (media), `api-account.ts` (accounts), `session.tsx` / `session-contract.ts`, `playback.ts`, `captions.ts`, `watch-sync.ts`, `read-sync.ts`, `history*.ts`, `seek.ts`, `rows.ts`, `format.ts`, `types.ts`, `media-types.ts`; unit tests in `__tests__/`.
- `api/src/` — Nest modules `auth/`, `users/`, `history/`, `reading-history/`, `my-list/`, `health/`, infra `prisma/`, `redis/`, shared `common/` (`env.ts`, `guards/`, `decorators/`, `types/`, `account.types.ts`).
- `api/prisma/` — `schema.prisma`: `User` 1—N `WatchHistory`/`ReadingHistory`/`MyList`; composite uniques per `(userId, provider, mediaId, season/episode|chapter)`.
- `MovieBox-Tui/server/` — Rust backend crate; parent `MovieBox-Tui/` is the vendored TUI fork (`src/`, `tests/`, `docs/`).
- `manga-scrapper/src/` — .NET `Services/MangaScrapper/`, `Workers/Scrapper.Worker/`, `BuildingBlocks/NovaStack.*`; `tests/` holds xUnit suites.
- `scripts/` — `dev.mjs` (dev orchestrator), `sync-backend.sh` (upstream merge), `docker-entrypoint.sh` (prod launcher), `anime-scraper/` (Go + Node sidecar).
- `public/` — static assets (`logo.svg`); `.zcode/plans/` — design notes.

## Development Commands

```sh
npm run dev          # orchestrate everything (backend :9797, Nest :4100, Next :3000, scraper :9798); skips occupied ports
npm run dev:web      # Next.js only
npm run backend      # Rust backend release run (MovieBox-Tui/server)
npm run build && npm start   # Next standalone build / serve
npm test             # vitest run (root, src/ only)
npm run test:coverage # vitest run --coverage (v8)
npm run sync:backend # merge upstream mesamirh/MovieBox-Tui (requires clean MovieBox-Tui tree)
npm run scraper      # anime-scraper sidecar
docker compose -f docker-compose.dev.yml up --build   # hot-reload dev (db/redis/api/backend/web)
```

- Nest (`api/`): `npm run build` = `prisma generate && tsc -p tsconfig.build.json`; `npm start` = `node dist/main.js`. Needs `DATABASE_URL` + `REDIS_URL` or `docker compose up -d db redis`.
- No lint/format/typecheck scripts at root — run `npx tsc --noEmit` ad hoc. Rust hygiene lives in the fork: `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`.

## Code Conventions & Common Patterns

- TypeScript strict (`strict`, `noImplicitAny`, `noFallthroughCasesInSwitch` in `api/`); path alias `@/*` → `./src/*`; `ES2022` + `bundler` resolution + `react-jsx` at root, `CommonJS` + decorators in `api/`. Kebab-case files, PascalCase components, camelCase functions.
- Frontend client pattern (`src/lib/api.ts`, `src/lib/api-account.ts`): module-local `const JSON_HEADERS`, generic `request<T>(path, init)` doing `fetch` → `res.ok` check → typed cast (`HomeResponse`, `PlayResponse`, … from `@/lib/types`); throw `ApiError`/`AccountError` carrying `.status`. Always `encodeURIComponent` query params, e.g. `` `/search?q=${encodeURIComponent(q)}&provider=${provider}&page=${page}` ``.
- Same-origin mapping: `mbUrl("/api/transcode/<s>/index.m3u8")` → `/api/mb/transcode/<s>/index.m3u8`.
- State pattern (`src/lib/session.tsx`): pure helpers (`listKey` = `provider:id`, `upsertEntry` sorts desc by `updatedAt`, `entryMatches`) + `createContext` triple; constants `DEFAULT_SETTINGS = { region: "ph", provider: "moviebox" }`, `REGION_IDS = ["ph","us","in","sg"]`. New context state goes through `session-contract.ts` first.
- Nest patterns: constructor DI (`prisma`, `jwt`, `rateLimit`, `denylist`), `@Injectable()` services, DTOs (`LoginDto`, `RegisterDto`) validated by the global pipe; errors via built-ins (`ConflictException` on Prisma `P2002`, `UnauthorizedException` on bad login). Passwords: `hashSync(pw, 10)` / `compareSync`. Sessions: `jwt.signAsync({ sub, email, jti: randomUUID() })`; logout revokes `jti` until `exp`.
- Env pattern (`api/src/common/env.ts`): read at import time with dev fallbacks (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` + `JWT_SECRET_IS_DEFAULT`, `PORT` from `API_PORT ?? PORT ?? 4100`, `PRISMA_AUTO_PUSH !== '0'`). `scripts/dev.mjs` has its own minimal `.env` loader; process env always wins.
- Styling: Tailwind v4 (`@tailwindcss/postcss`, `src/app/globals.css`), font vars `--font-inter/--font-display/--font-mono` set in `layout.tsx`; dark theme utilities (`bg-ink`, `border-line`, `text-brand`).

## Important Files

- Entry points: `src/app/layout.tsx` + `src/app/page.tsx`; `src/lib/api.ts`, `src/lib/api-account.ts`, `src/lib/session.tsx`; `api/src/main.ts`, `api/src/app.module.ts`; `MovieBox-Tui/server/src/main.rs`; `scripts/dev.mjs`.
- Config: `package.json` (root scripts/deps), `api/package.json`, `tsconfig.json` (`@/*`, excludes `MovieBox-Tui`, `api`), `api/tsconfig.json` + `tsconfig.build.json`, `vitest.config.ts`, `src/test-setup.ts`, `next.config.ts` (proxy rewrites), `postcss.config.mjs`, `api/prisma/schema.prisma`, `Dockerfile` (Rust → Next standalone → single runtime + ffmpeg), `docker-compose.dev.yml` / `docker-compose.yml`, `.env` (ports/secrets).
- Key modules: `src/components/watch-player.tsx`, `src/lib/playback.ts`, `src/lib/captions.ts`, `api/src/auth/auth.service.ts`, `api/src/common/env.ts`, `api/src/common/account.types.ts`.

## Runtime/Tooling Preferences

- Node `>=20` (Docker uses `node:22-slim`); package manager is **npm** with lockfiles (`package-lock.json` at root and `api/`). Do not introduce Bun/pnpm workspaces.
- Rust edition 2024 (server; TUI crate pins `rust-version 1.90`, Docker builds with `rust:1.97-bookworm`); .NET solution `manga-scrapper/*.sln` (`dotnet test`); Go module in `scripts/anime-scraper/`.
- Framework pins: Next `16.3.5` (read `node_modules/next/dist/docs/` before writing App Router code), React `19`, Tailwind `4.1`, Prisma `6.19.3`, Postgres `16-alpine`, Redis `7-alpine`. Runtime image needs `ffmpeg` (HEVC→H.264 live transcode).
- Env knobs: `MB_BACKEND_URL`, `MOVIEBOX_SERVER_PORT`, `MOVIEBOX_PROXY_BASE` (public origin for manifests), `API_PORT`/`API_HOST`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`/`JWT_TTL`, `PRISMA_AUTO_PUSH`, `*_HOST_PORT` port overrides in `.env`.

## Testing & QA

- Root: **Vitest 5 + jsdom + @vitest/coverage-v8**. `vitest.config.ts`: `globals: true`, `include: ["src/**/*.{test,spec}.ts?(x)"]`, `setupFiles: ["./src/test-setup.ts"]` (matchMedia/rAF shims), alias `@` → `src`, coverage over `src/**/*.{ts,tsx}` with no thresholds.
- Suites: 14 in `src/lib/__tests__/` (pure logic: `format`, `seek`, `playback`, `captions`, `history`, `history-merge`, `rows`, `watch-sync`, `types`, `media-types`, `session-contract`, `api`, `api-account`, `account`) + 5 in `src/components/__tests__/` (`transcode-window`, `seek-routing`, `seek-pin`, `seek-commit`, `raf-display`). Convention: `import { describe, it, expect } from "vitest"`, one `describe` per function, dense boundary cases (`null`/`undefined`/`0`/`NaN`/`Infinity`/rollover); component behavior tested headlessly against `src/lib` helpers, no DOM mounting.
- No ESLint/Prettier/Biome, no root CI. Only CI is `MovieBox-Tui/.github/workflows/ci.yml` (fmt, clippy `-D warnings`, audit, matrix `cargo test --all-features --locked`, `--version` smoke); its `docs/testing.md` + `.githooks/pre-commit` define that fork's QA.
- Gaps: `api/` (Nest) and `scripts/anime-scraper/` (Go) have zero tests; `api/tsconfig.build.json` excludes `*.spec.ts`/`*.test.ts` as a reserved-but-unimplemented contract. `manga-scrapper/tests/` are xUnit + FluentAssertions + Moq (`UnitTests`/`IntegrationTests`/`ArchitectureTests` via NetArchTest).
