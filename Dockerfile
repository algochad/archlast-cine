# syntax=docker/dockerfile:1

# ---- backend: MovieBox-Tui headless server (Rust) ----
FROM rust:1.97-bookworm AS backend
WORKDIR /src
COPY MovieBox-Tui ./moviebox
RUN cargo build --release --manifest-path moviebox/server/Cargo.toml \
    && strip -s moviebox/server/target/release/moviebox-server

# ---- web: Next.js standalone build ----
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime: single container, backend + Next on one origin ----
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
    MB_BACKEND_URL=http://127.0.0.1:9797
# Override at run time with the externally visible origin, e.g.
# MOVIEBOX_PROXY_BASE=https://movies.example.com
COPY --from=backend /src/moviebox/server/target/release/moviebox-server /usr/local/bin/moviebox-server
COPY --from=web /app/.next/standalone /app
COPY --from=web /app/.next/static /app/.next/static
COPY --from=web /app/public /app/public
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
