import type { NextRequest } from "next/server";

// Proxies /api/mb/* to the Rust backend with a generous timeout for slow
// anime resolves (sidecar fan-out can take 45s+ on cold cache).
// Replaces the next.config.ts rewrite for this path, which has no timeout
// control and drops the connection ~30s in (ECONNRESET -> browser 500).
const BACKEND = process.env.MB_BACKEND_URL ?? "http://127.0.0.1:9797";
const TIMEOUT_MS = 120_000;

async function proxy(req: NextRequest, method: string) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/mb/, "/api") + url.search;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = new Headers();
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
    const res = await fetch(`${BACKEND}${path}`, {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    const buf = await res.arrayBuffer();
    const outHeaders = new Headers();
    const ct = res.headers.get("content-type");
    if (ct) outHeaders.set("content-type", ct);
    return new Response(buf, { status: res.status, headers: outHeaders });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return Response.json({ error: "backend request timed out" }, { status: 504 });
    }
    return Response.json({ error: "backend unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  return proxy(req, "GET");
}

export async function POST(req: NextRequest) {
  return proxy(req, "POST");
}

export async function PUT(req: NextRequest) {
  return proxy(req, "PUT");
}

export async function PATCH(req: NextRequest) {
  return proxy(req, "PATCH");
}

export async function DELETE(req: NextRequest) {
  return proxy(req, "DELETE");
}
