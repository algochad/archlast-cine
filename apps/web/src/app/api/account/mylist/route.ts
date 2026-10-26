import type { NextRequest } from "next/server";
import { bearerToken, errorResponse, jsonBody, proxyNest } from "../_lib";

function listPath(req: NextRequest): string {
  const qs = req.nextUrl.searchParams.toString();
  return qs ? `/v1/me/mylist?${qs}` : "/v1/me/mylist";
}

export async function GET(req: NextRequest) {
  return proxyNest({ method: "GET", path: listPath(req), token: bearerToken(req), guarded: true });
}

/** Idempotent add; the { item } envelope is the Nest DTO. */
export async function POST(req: NextRequest) {
  const body = await jsonBody(req);
  if (!body) return errorResponse(400, "invalid request body");
  return proxyNest({ method: "POST", path: "/v1/me/mylist", token: bearerToken(req), body, guarded: true });
}

export async function DELETE(req: NextRequest) {
  return proxyNest({
    method: "DELETE",
    path: listPath(req),
    token: bearerToken(req),
    guarded: true,
  });
}
