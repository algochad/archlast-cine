import type { NextRequest } from "next/server";

// Proxies /api/mb/* to the Rust backend with a generous timeout for slow
// anime resolves (sidecar fan-out can take 45s+ on cold cache).
// Streams the response body directly via ReadableStream and
// AbortSignal.timeout(120_000) — never calls arrayBuffer() on the media
// path — so large transcode segments/manifests pipe without buffering
// the whole body in the Next process and without the ~30s rewrite drop.
const BACKEND = process.env.MB_BACKEND_URL ?? "http://127.0.0.1:9797";
const TIMEOUT_MS = 120_000;

const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
] as const;

async function proxy(req: NextRequest) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/mb/, "/api") + url.search;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const range = req.headers.get("range");
  if (range) headers.set("range", range);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== null;

  try {
    const res = await fetch(`${BACKEND}${path}`, {
      method: req.method,
      headers,
      body: hasBody ? (req.body as unknown as BodyInit) : undefined,
      ...(hasBody ? ({ duplex: "half" } as unknown as Record<string, unknown>) : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    const outHeaders = new Headers();
    for (const name of PASS_HEADERS) {
      const v = res.headers.get(name);
      if (v) outHeaders.set(name, v);
    }

    // Stream backend body directly — never buffers whole segment/manifest.
    return new Response(res.body, {
      status: res.status,
      headers: outHeaders,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return Response.json({ error: "backend request timed out" }, { status: 504 });
    }
    return Response.json({ error: "backend unavailable" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
