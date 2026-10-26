import type { NextRequest } from "next/server";

// Streaming proxy for /api/proxy/:ticket(/*) — replaces next.config.ts rewrite
// which buffered the whole body and dropped connections ~30s in.
// Pipes ReadableStream with AbortSignal.timeout(120_000), never calls arrayBuffer().
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
  const backendUrl = `${BACKEND}${url.pathname}${url.search}`;

  const headers = new Headers();
  // Range is critical for seeking; preserve it. Also forward Accept where present
  // to keep backend content-negotiation intact without leaking extra headers.
  const range = req.headers.get("range");
  if (range) headers.set("range", range);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body != null;

  try {
    const res = await fetch(backendUrl, {
      method: req.method,
      headers,
      // Stream request body if present; duplex required for Node's fetch with a stream.
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

    // Stream backend body directly — never buffers whole segment.
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

export async function GET(req: NextRequest) {
  return proxy(req);
}

export async function HEAD(req: NextRequest) {
  return proxy(req);
}

export async function POST(req: NextRequest) {
  return proxy(req);
}

export async function PUT(req: NextRequest) {
  return proxy(req);
}

export async function PATCH(req: NextRequest) {
  return proxy(req);
}

export async function DELETE(req: NextRequest) {
  return proxy(req);
}

export async function OPTIONS(req: NextRequest) {
  return proxy(req);
}
