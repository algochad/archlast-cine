import type { NextRequest } from "next/server";
import { bearerToken, errorResponse, jsonBody, proxyNest } from "../../_lib";

/** Bulk import of local/anon reading history into the account; { entries } DTO. */
export async function POST(req: NextRequest) {
  const body = await jsonBody(req);
  if (!body) return errorResponse(400, "invalid request body");
  return proxyNest({
    method: "POST",
    path: "/v1/me/reading-history/import",
    token: bearerToken(req),
    body,
    guarded: true,
  });
}