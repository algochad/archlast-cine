import { describe, it, expect, afterEach, vi } from "vitest";
import { api, mbUrl } from "../api";
import { ApiError } from "../types";

const g = globalThis as unknown as { fetch: unknown };
const realFetch = g.fetch;

afterEach(() => {
  g.fetch = realFetch;
  vi.restoreAllMocks();
});

function okJson<T>(payload: T, status = 200) {
  return {
    ok: true,
    status,
    json: async () => payload,
  } as Response;
}

function errJson(status: number, payload: unknown) {
  return {
    ok: false,
    status,
    json: async () => payload,
  } as Response;
}

function fetchMock(res: Response | Promise<Response>) {
  const fn = vi.fn(async () => res);
  g.fetch = fn;
  return fn;
}

describe("request builders: URL mapping and method plumbing", () => {
  it("health hits the mb-prefixed path with no-store caching", async () => {
    const fn = fetchMock(okJson({ ok: true }));
    await api.health();
    expect(fn).toHaveBeenCalledOnce();
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/mb/health");
    expect(init.cache).toBe("no-store");
  });
  it("home applies default tab and page", async () => {
    const fn = fetchMock(okJson({}));
    await api.home();
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/mb/home?tab=2&page=1");
  });
  it("home forwards explicit tab and page", async () => {
    const fn = fetchMock(okJson({}));
    await api.home("movie", 3);
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/mb/home?tab=movie&page=3");
  });
  it("search encodes unicode queries and defaults", async () => {
    const fn = fetchMock(okJson({}));
    await api.search("日本語 🎬 café & co?");
    const [url] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/mb/search?q=${encodeURIComponent("日本語 🎬 café & co?")}&provider=moviebox&page=1`);
  });
  it("details encodes provider-scoped ids", async () => {
    const fn = fetchMock(okJson({}));
    await api.details("moviebox", "a/b c?");
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      `/api/mb/details?provider=moviebox&id=${encodeURIComponent("a/b c?")}`,
    );
  });
  it("streams passes season and episode through", async () => {
    const fn = fetchMock(okJson({}));
    await api.streams("fourkhdhub", "x", 2, 7);
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      "/api/mb/streams?provider=fourkhdhub&id=x&season=2&episode=7",
    );
  });
  it("suggest encodes its query", async () => {
    const fn = fetchMock(okJson({}));
    await api.suggest("a&b");
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      `/api/mb/suggest?q=${encodeURIComponent("a&b")}`,
    );
  });
  it("captions encodes its id", async () => {
    const fn = fetchMock(okJson({}));
    await api.captions("id with spaces");
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      `/api/mb/captions?id=${encodeURIComponent("id with spaces")}`,
    );
  });
  it("play POSTs a JSON body", async () => {
    const fn = fetchMock(okJson({}));
    const body = { provider: "moviebox" as const, id: "x", season: 1, episode: 2, resolution: 1080 };
    await api.play(body);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/mb/play");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(body));
  });
  it("transcode builders hit session-scoped paths", async () => {
    const fn = fetchMock(okJson({}));
    await api.transcodeStart("ticket-1");
    await api.transcodeState("sess 1/2");
    await api.transcodeSeek("sess 1/2", 12.5);
    await api.transcodeDelete("sess-9");
    const urls = fn.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls[0]).toBe("/api/mb/transcode/start");
    expect(urls[1]).toBe(`/api/mb/transcode/${encodeURIComponent("sess 1/2")}/state`);
    expect(urls[2]).toBe(`/api/mb/transcode/${encodeURIComponent("sess 1/2")}/seek`);
    expect(urls[3]).toBe("/api/mb/transcode/sess-9");
    expect((fn.mock.calls[2] as unknown as [string, RequestInit])[1].body).toBe(
      JSON.stringify({ position_seconds: 12.5 }),
    );
    expect((fn.mock.calls[3] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });
});

describe("request behavior: success, errors, headers", () => {
  it("resolves with the parsed JSON body on success", async () => {
    fetchMock(okJson({ ok: true, version: "1.2.3" }));
    await expect(api.health()).resolves.toEqual({ ok: true, version: "1.2.3" });
  });
  it("surfaces the backend error message on JSON failures", async () => {
    fetchMock(errJson(404, { error: "not found" }));
    const err = (await api.health().catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
    expect(err.name).toBe("ApiError");
  });
  it("falls back to HTTP status text on non-JSON error bodies", async () => {
    const fn = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("not json");
      },
    }) as unknown as Response);
    g.fetch = fn;
    const err = (await api.health().catch((e) => e)) as ApiError;
    expect(err.status).toBe(500);
    expect(err.message).toBe("HTTP 500");
  });
  it("falls back to HTTP status when the error shape lacks an error field", async () => {
    fetchMock(errJson(422, { detail: "bad offset" }));
    const err = (await api.transcodeSeek("s", 999).catch((e) => e)) as ApiError;
    expect(err.status).toBe(422);
    expect(err.message).toBe("HTTP 422");
  });
  it("reports each HTTP status distinctly", async () => {
    for (const status of [400, 401, 403, 409, 422, 503]) {
      fetchMock(errJson(status, { error: `e${status}` }));
      const err = (await api.health().catch((e) => e)) as ApiError;
      expect(err.status).toBe(status);
      expect(err.message).toBe(`e${status}`);
    }
  });
  it("propagates network throws to the caller", async () => {
    g.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(api.health()).rejects.toThrow("fetch failed");
  });
  it("merges caller headers under the JSON content type", async () => {
    const fn = fetchMock(okJson({}));
    await api.play({ provider: "moviebox", id: "x" });
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
  it("sends caller headers with the JSON content type on every request", async () => {
    const fn = fetchMock(okJson({}));
    await api.transcodeDelete("s1");
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.cache).toBe("no-store");
  });
});

describe("mbUrl", () => {
  it("rewrites backend /api/ paths through the mb proxy prefix", () =>
    expect(mbUrl("/api/transcode/s1/index.m3u8")).toBe("/api/mb/transcode/s1/index.m3u8"));
  it("passes non-/api/ paths through untouched", () => {
    expect(mbUrl("https://cdn.example/x.m3u8")).toBe("https://cdn.example/x.m3u8");
    expect(mbUrl("/static/x.m3u8")).toBe("/static/x.m3u8");
  });
  it("passes empty input through", () => expect(mbUrl("")).toBe(""));
  it("rewrites bare /api/ exactly", () => expect(mbUrl("/api/")).toBe("/api/mb/"));
  it("leaves already-rewritten input to the caller (pure prefix rule)", () =>
    expect(mbUrl("/api/mb/x")).toBe("/api/mb/mb/x"));
  it("keeps query strings intact", () =>
    expect(mbUrl("/api/transcode/s1/index.m3u8?token=a&b=c")).toBe(
      "/api/mb/transcode/s1/index.m3u8?token=a&b=c",
    ));
  it("passes unicode paths through the rewrite", () =>
    expect(mbUrl("/api/日本語/🎬.m3u8")).toBe("/api/mb/日本語/🎬.m3u8"));
});
