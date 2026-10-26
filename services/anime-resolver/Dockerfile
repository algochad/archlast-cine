# syntax=docker/dockerfile:1
# Build context: the repository root (`docker build -f services/anime-resolver/Dockerfile .`).

# ---- build: static Go binary for the anime scraper sidecar ----
FROM golang:1.22-bookworm AS build
WORKDIR /src
COPY services/anime-resolver/go.mod services/anime-resolver/go.sum ./services/anime-resolver/
WORKDIR /src/services/anime-resolver
RUN go mod download
WORKDIR /src
COPY services/anime-resolver ./services/anime-resolver
WORKDIR /src/services/anime-resolver
RUN CGO_ENABLED=0 go build -trimpath -o /out/anime-scraper .

# ---- runtime: alpine + CA certs + wget for healthcheck ----
# Alpine (not distroless): the healthcheck shells out to wget, and
# ca-certificates keeps upstream HTTPS providers (anineko, anipub, …)
# working. Chromium for AnimePahe/rod is NOT bundled — pin one via
# ROD_BIN or mount it; other providers resolve without a browser.
FROM alpine:3.20 AS runtime
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/anime-scraper /usr/local/bin/anime-scraper
ENV SCRAPER_HOST=0.0.0.0 \
    SCRAPER_PORT=9798
EXPOSE 9798
ENTRYPOINT ["/usr/local/bin/anime-scraper"]
