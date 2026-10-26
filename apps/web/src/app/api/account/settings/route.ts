import type { NextRequest } from "next/server";
import { bearerToken, errorResponse, jsonBody, proxyNest, withRegionCookie } from "../_lib";

export async function PATCH(req: NextRequest) {
  const body = await jsonBody(req);
  if (!body) return errorResponse(400, "invalid request body");
  return proxyNest({
    method: "PATCH",
    path: "/v1/users/me/settings",
    token: bearerToken(req),
    body,
    guarded: true,
    onOk: (status, text) => withRegionCookie(status, text),
  });
}
