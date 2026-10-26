# syntax=docker/dockerfile:1
# Build context: the repository root (`docker build -f apps/api/Dockerfile .`).

# ---- build: install deps, generate the Prisma client, compile TypeScript ----
FROM node:22-slim AS build
WORKDIR /app
# openssl is what Prisma's engine loader probes for on Debian; keep it explicit.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY services/media-gateway/package.json services/media-gateway/
COPY services/anime-resolver/package.json services/anime-resolver/
COPY crates/media-engine/package.json crates/media-engine/
RUN npm ci --workspace @archlast/api --workspace @archlast/contracts --include-workspace-root --no-audit --no-fund
COPY packages ./packages
COPY apps/api ./apps/api
RUN npx turbo run build --filter=@archlast/api

# ---- runtime: dist + the build stage's node_modules (Prisma client + engines) ----
FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=4100 \
    API_HOST=0.0.0.0
# node_modules is copied whole: it carries the generated Prisma client, the
# query/schema engines, the `prisma` CLI that the boot-time `db push` uses, and
# the @archlast/contracts workspace link (resolved to packages/contracts below).
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
WORKDIR /app/apps/api
EXPOSE 4100
CMD ["node", "dist/main.js"]
