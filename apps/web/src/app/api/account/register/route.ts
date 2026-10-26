import type { NextRequest } from "next/server";
import { errorResponse, jsonBody, proxyNest, withAuthCookies } from "../_lib";

export async function POST(req: NextRequest) {
  const body = await jsonBody(req);
  if (!body) return errorResponse(400, "invalid request body");
  return proxyNest({
    method: "POST",
    path: "/v1/auth/register",
    body,
    onOk: (status, text) => withAuthCookies(status, text),
  });
}
