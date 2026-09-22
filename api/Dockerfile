# syntax=docker/dockerfile:1

# ---- build: install deps, generate the Prisma client, compile TypeScript ----
FROM node:22-slim AS build
WORKDIR /app
# openssl is what Prisma's engine loader probes for on Debian; keep it explicit.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

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
# query/schema engines, and the `prisma` CLI that the boot-time `db push` uses.
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
EXPOSE 4100
CMD ["node", "dist/main.js"]
