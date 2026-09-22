import { NextResponse, type NextRequest } from "next/server";

/** Internal NestJS origin — the browser never talks to Nest directly. */
export function authOrigin(): string {
  return process.env.API_URL ?? "http://127.0.0.1:4100";
}

export const TOKEN_COOKIE = "mb_token";
export const REGION_COOKIE = "mb_region";
export const REGION_VALUES = ["ph", "us", "in", "sg"] as const;
export type RegionValue = (typeof REGION_VALUES)[number];

export function isRegion(value: unknown): value is RegionValue {
  return typeof value === "string" && (REGION_VALUES as readonly string[]).includes(value);
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, mirrors a long-lived session

/** Secure only over TLS deployments; local http dev must stay plain. */
function cookieSecure(): boolean {
  const flag = process.env.MB_COOKIE_SECURE;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
}

function cookieOptions(httpOnly: boolean) {
  return {
    httpOnly,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

export function bearerToken(req: NextRequest): string | null {
  return req.cookies.get(TOKEN_COOKIE)?.value ?? null;
}

export function guarded401(): NextResponse {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}

function errorMessage(status: number, text: string, fallback: string): string {
  if (text) {
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message.length > 0) return parsed.message;
    } catch {
      /* non-JSON body — fall through to the fallback */
    }
  }
  return fallback;
}

export function errorResponse(status: number, fallback: string, text = ""): NextResponse {
  return NextResponse.json({ error: errorMessage(status, text, fallback) }, { status });
}

function passthrough(res: Response, text: string): NextResponse {
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}

/** Parse a Nest JSON payload leniently (missing/malformed -> null). */
export function parsePayload<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Read the request body as a JSON object; null when absent or not JSON. */
export async function jsonBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const raw = (await req.json()) as unknown;
    return raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function attachSessionCookies(res: NextResponse, token: string, region: unknown): void {
  res.cookies.set(TOKEN_COOKIE, token, cookieOptions(true));
  if (isRegion(region)) res.cookies.set(REGION_COOKIE, region, cookieOptions(false));
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(TOKEN_COOKIE, "", { ...cookieOptions(true), maxAge: 0 });
  res.cookies.set(REGION_COOKIE, "", { ...cookieOptions(false), maxAge: 0 });
}

/** Successful login/register: set the httpOnly token + readable region cookies. */
export function withAuthCookies(status: number, text: string): NextResponse {
  const payload = parsePayload<{ accessToken?: unknown; settings?: { region?: unknown } }>(text);
  const res = new NextResponse(text, { status, headers: { "content-type": "application/json" } });
  if (typeof payload?.accessToken === "string" && payload.accessToken.length > 0) {
    attachSessionCookies(res, payload.accessToken, payload.settings?.region);
  }
  return res;
}

/** Sync the readable region cookie whenever an authed payload carries settings. */
export function withRegionCookie(status: number, text: string): NextResponse {
  const payload = parsePayload<{ settings?: { region?: unknown } }>(text);
  const res = new NextResponse(text, { status, headers: { "content-type": "application/json" } });
  if (payload?.settings && isRegion(payload.settings.region)) {
    res.cookies.set(REGION_COOKIE, payload.settings.region, cookieOptions(false));
  }
  return res;
}

export interface NestCall {
  method: string;
  /** Path on the Nest service, e.g. "/v1/me/history". */
  path: string;
  token?: string | null;
  body?: unknown;
  /** Guarded endpoints require mb_token and map upstream 401s to {error:'unauthenticated'}. */
  guarded?: boolean;
  /** Hook into a successful response (cookie sync). Return null to keep the default passthrough. */
  onOk?: (status: number, text: string, res: Response) => NextResponse | null;
}

export async function proxyNest(call: NestCall): Promise<NextResponse> {
  if (call.guarded && !call.token) return guarded401();
  const headers: Record<string, string> = { accept: "application/json" };
  let body: string | undefined;
  if (call.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(call.body);
  }
  if (call.token) headers.authorization = `Bearer ${call.token}`;
  let res: Response;
  try {
    res = await fetch(`${authOrigin()}${call.path}`, {
      method: call.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json({ error: "account service unreachable" }, { status: 502 });
  }
  const text = await res.text();
  if (call.guarded && res.status === 401) return guarded401();
  if (!res.ok) return errorResponse(res.status, `request failed (HTTP ${res.status})`, text);
  if (call.onOk) {
    const custom = call.onOk(res.status, text, res);
    if (custom) return custom;
  }
  return passthrough(res, text);
}
