#!/bin/sh
set -e

# Launch the Rust backend in the background, then Next's standalone server.
# The backend proxies every stream byte; MOVIEBOX_PROXY_BASE must be the
# external origin browsers use so DASH manifests keep working behind the
# reverse proxy.
moviebox-server &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

exec node /app/apps/web/server.js
