# syntax=docker/dockerfile:1
# Build context: the repository root (`docker build -f apps/web/Dockerfile .`).
#
# One runtime image carries the Rust media gateway AND the Next.js server, so
# every stream byte stays same-origin behind a single exposed port.

# ---- gateway: Rust media gateway (services/media-gateway + crates/media-engine) ----
FROM rust:1.97-bookworm AS gateway
WORKDIR /src
COPY crates/media-engine ./crates/media-engine
COPY services/media-gateway ./services/media-gateway
RUN cargo build --release --manifest-path services/media-gateway/Cargo.toml \
    && strip -s services/media-gateway/target/release/moviebox-server

# ---- web: Next.js standalone build (apps/web) via Turborepo ----
FROM node:22-slim AS web
WORKDIR /app
# Manifests first so the dependency layer is cached until a package.json changes.
COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY services/media-gateway/package.json services/media-gateway/
COPY services/anime-resolver/package.json services/anime-resolver/
COPY crates/media-engine/package.json crates/media-engine/
RUN npm ci --workspace @archlast/web --workspace @archlast/contracts --include-workspace-root --no-audit --no-fund
COPY packages ./packages
COPY apps/web ./apps/web
RUN npx turbo run build --filter=@archlast/web

# ---- runtime: single container, gateway + Next on one origin ----
FROM node:22-slim AS runtime
# ffmpeg powers the HEVC -> H.264 live transcode fallback for browsers
# without HEVC decode.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MOVIEBOX_SERVER_HOST=127.0.0.1 \
    MOVIEBOX_SERVER_PORT=9797 \
    MOVIEBOX_REGION=ph \
    MB_BACKEND_URL=http://127.0.0.1:9797 \
    RUST_LOG=moviebox_server=debug,moviebox_tui=info
# Override at run time with the externally visible origin, e.g.
# MOVIEBOX_PROXY_BASE=https://movies.example.com
COPY --from=gateway /src/services/media-gateway/target/release/moviebox-server /usr/local/bin/moviebox-server
# Standalone output is laid out relative to the monorepo root (outputFileTracingRoot).
COPY --from=web /app/apps/web/.next/standalone /app
COPY --from=web /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=web /app/apps/web/public /app/apps/web/public
COPY apps/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
