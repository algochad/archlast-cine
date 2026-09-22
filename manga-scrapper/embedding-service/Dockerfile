# Stage 1: Builder
FROM rust:bookworm AS builder

# Install build dependencies required for native compilation and HTTPS artifact fetching
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    pkg-config \
    libssl-dev \
    ca-certificates \
    curl \
    build-essential \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/embedding-service

# Cache dependencies
COPY Cargo.toml build.rs ./
COPY proto ./proto
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

# Compile source code
COPY src ./src
RUN touch src/main.rs && cargo build --release

# Stage 2: Minimal Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/src/embedding-service/target/release/embedding-service /app/embedding-service

EXPOSE 8222

ENV PORT=8222
ENV RUST_LOG=info
ENV MODEL_PATH=/app/models/model.onnx
ENV TOKENIZER_PATH=/app/models/tokenizer.json

CMD ["/app/embedding-service"]