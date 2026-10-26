// Server-component access to the Rust media gateway. Never imported by client
// code: it reads MB_BACKEND_URL at request time.

export const BACKEND = process.env.MB_BACKEND_URL ?? "http://127.0.0.1:9797";

export type BackendResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; error: string };

export async function backendJson<T>(path: string, timeoutMs = 8000): Promise<BackendResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND}${path}`, { cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      let message = `Backend replied HTTP ${res.status}.`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* non-json error body */
      }
      return { ok: false, status: res.status, error: message };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "request timed out" : (e as Error).message;
    return { ok: false, status: null, error: `Backend unreachable (${reason}).` };
  } finally {
    clearTimeout(timer);
  }
}
