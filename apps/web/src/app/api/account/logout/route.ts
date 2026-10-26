import { NextResponse, type NextRequest } from "next/server";
import { authOrigin, bearerToken, clearSessionCookies } from "../_lib";

/**
 * Clears the session cookies and best-effort revokes the token upstream —
 * logout must succeed locally even if the account service is unreachable.
 */
export async function POST(req: NextRequest) {
  const token = bearerToken(req);
  if (token) {
    try {
      await fetch(`${authOrigin()}/v1/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      /* token revocation is best-effort; cookies are cleared regardless */
    }
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
