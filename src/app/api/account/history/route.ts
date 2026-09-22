import type { NextRequest } from "next/server";
import { bearerToken, errorResponse, jsonBody, proxyNest } from "../_lib";

function listPath(req: NextRequest): string {
  const qs = req.nextUrl.searchParams.toString();
  return qs ? `/v1/me/history?${qs}` : "/v1/me/history";
}

export async function GET(req: NextRequest) {
  return proxyNest({ method: "GET", path: listPath(req), token: bearerToken(req), guarded: true });
}

/** Upserts one watch entry; the { entry } envelope is the Nest DTO. */
export async function POST(req: NextRequest) {
  const body = await jsonBody(req);
  if (!body) return errorResponse(400, "invalid request body");
  return proxyNest({ method: "POST", path: "/v1/me/history", token: bearerToken(req), body, guarded: true });
}

export async function DELETE(req: NextRequest) {
  return proxyNest({
    method: "DELETE",
    path: listPath(req),
    token: bearerToken(req),
    guarded: true,
  });
}
