import { describe, it, expect, afterEach, vi } from "vitest";
import type { AccountState, MyListItem, WatchEntry } from "../account";
import { accountApi, importHistory, AccountError } from "../api-account";
import type { WatchEntryInput } from "../api-account";

const g = globalThis as unknown as { fetch: unknown };
const realFetch = g.fetch;

afterEach(() => {
  g.fetch = realFetch;
  vi.restoreAllMocks();
});

function okJson<T>(payload: T, status = 200) {
  return { ok: true, status, json: async () => payload } as Response;
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

const STATE: AccountState = {
  user: { id: 1, email: "a@example.com", name: "Ada", createdAt: "2024-01-01" },
  settings: { region: "us", provider: "moviebox" },
};

function watchInput(id = "w1"): WatchEntryInput {
  return {
    provider: "moviebox",
    id,
    title: "Title",
    poster: null,
    mediaType: "movie",
    year: null,
    season: 0,
    episode: 0,
    position: 10,
    duration: 100,
  };
}

describe("AccountError", () => {
  it("carries message and status", () => {
    const err = new AccountError("nope", 401);
    expect(err.message).toBe("nope");
    expect(err.status).toBe(401);
    expect(err).toBeInstanceOf(Error);
  });
  it("names itself AccountError", () => {
    expect(new AccountError("x", 500).name).toBe("AccountError");
  });
  it("preserves unicode messages", () => {
    expect(new AccountError("日本語 🎬", 400).message).toBe("日本語 🎬");
  });
  it("preserves empty messages", () => {
    expect(new AccountError("", 400).message).toBe("");
  });
  it("keeps distinct statuses distinct", () => {
    expect(new AccountError("a", 401).status).not.toBe(new AccountError("a", 403).status);
  });
});

describe("accountApi request builders", () => {
  it("config GETs the account config endpoint", async () => {
    const fn = fetchMock(okJson({ availableRegions: ["us"], defaultRegion: "us" }));
    await accountApi.config();
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/account/config");
  });
  it("register POSTs its input as JSON", async () => {
    const fn = fetchMock(okJson(STATE));
    const input = { name: "Ada", email: "a@example.com", password: "s3cret" };
    await expect(accountApi.register(input)).resolves.toEqual(STATE);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/register");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(input));
  });
  it("login POSTs credentials", async () => {
    const fn = fetchMock(okJson(STATE));
    await accountApi.login({ email: "a@example.com", password: "pw" });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/login");
    expect(init.method).toBe("POST");
  });
  it("logout POSTs without a body", async () => {
    const fn = fetchMock(okJson({ ok: true }));
    await expect(accountApi.logout()).resolves.toEqual({ ok: true });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/logout");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });
  it("me GETs the session endpoint", async () => {
    const fn = fetchMock(okJson(STATE));
    await expect(accountApi.me()).resolves.toEqual(STATE);
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/account/me");
  });
  it("updateSettings PATCHes and unwraps settings", async () => {
    const fn = fetchMock(okJson({ settings: { region: "ph", provider: "moviebox" } }));
    await expect(accountApi.updateSettings({ region: "ph" })).resolves.toEqual({
      region: "ph",
      provider: "moviebox",
    });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/settings");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ region: "ph" }));
  });
  it("updateName PATCHes and unwraps the user", async () => {
    const fn = fetchMock(okJson({ user: STATE.user }));
    await expect(accountApi.updateName("Ada")).resolves.toEqual(STATE.user);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/me");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "Ada" }));
  });
  it("history unwraps entries", async () => {
    const entry: WatchEntry = { ...watchInput("h1"), updatedAt: 5 };
    const fn = fetchMock(okJson({ entries: [entry] }));
    await expect(accountApi.history()).resolves.toEqual([entry]);
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/account/history");
  });
  it("recordHistory POSTs the entry and unwraps it", async () => {
    const saved: WatchEntry = { ...watchInput("h2"), updatedAt: 9 };
    const fn = fetchMock(okJson({ entry: saved }));
    await expect(accountApi.recordHistory(watchInput("h2"))).resolves.toEqual(saved);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/history");
    expect(init.method).toBe("POST");
  });
  it("importHistory POSTs bulk entries and returns the count", async () => {
    const fn = fetchMock(okJson({ count: 2 }));
    await expect(importHistory([watchInput("a"), watchInput("b")])).resolves.toEqual({ count: 2 });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/history/import");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ entries: [watchInput("a"), watchInput("b")] }));
  });
  it("removeHistory DELETEs with provider/id/season/episode query", async () => {
    const fn = fetchMock(okJson(undefined, 204));
    await accountApi.removeHistory("moviebox", "abc", 2, 7);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(url.startsWith("/api/account/history?")).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("provider")).toBe("moviebox");
    expect(params.get("id")).toBe("abc");
    expect(params.get("season")).toBe("2");
    expect(params.get("episode")).toBe("7");
  });
  it("removeHistory omits undefined season/episode from the query", async () => {
    const fn = fetchMock(okJson(undefined, 204));
    await accountApi.removeHistory("moviebox", "abc");
    const [url] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/history?provider=moviebox&id=abc");
  });
  it("mylist unwraps items", async () => {
    const item: MyListItem = {
      provider: "moviebox",
      id: "m1",
      title: "T",
      poster: null,
      mediaType: "series",
      year: "2024",
      addedAt: 3,
    };
    const fn = fetchMock(okJson({ items: [item] }));
    await expect(accountApi.mylist()).resolves.toEqual([item]);
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/account/mylist");
  });
  it("addToMyList POSTs and unwraps the saved item", async () => {
    const saved: MyListItem = {
      provider: "moviebox",
      id: "m1",
      title: "T",
      poster: null,
      mediaType: "anime",
      year: null,
      addedAt: 8,
    };
    const fn = fetchMock(okJson({ item: saved }));
    const { addedAt: _dropped, ...input } = saved;
    void _dropped;
    await expect(accountApi.addToMyList(input)).resolves.toEqual(saved);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/mylist");
    expect(init.method).toBe("POST");
  });
  it("removeFromMyList DELETEs with the provider/id query", async () => {
    const fn = fetchMock(okJson(undefined, 204));
    await accountApi.removeFromMyList("moviebox", "m 1/2?");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("provider")).toBe("moviebox");
    expect(params.get("id")).toBe("m 1/2?");
  });
});

describe("accountApi transport behavior", () => {
  it("sends same-origin credentials on every request", async () => {
    const fn = fetchMock(okJson(STATE));
    await accountApi.me();
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[1].credentials).toBe("same-origin");
  });
  it("sets JSON headers when a body is present", async () => {
    const fn = fetchMock(okJson(STATE));
    await accountApi.login({ email: "a", password: "b" });
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({
      "Content-Type": "application/json",
    });
  });
  it("omits the content-type header on bodyless requests", async () => {
    const fn = fetchMock(okJson(STATE));
    await accountApi.me();
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toBeUndefined();
  });
  it("resolves undefined for 204 responses", async () => {
    fetchMock(okJson(undefined, 204));
    await expect(accountApi.removeHistory("moviebox", "x")).resolves.toBeUndefined();
  });
  it("resolves undefined for 205 responses", async () => {
    fetchMock(okJson(undefined, 205));
    await expect(accountApi.removeFromMyList("moviebox", "x")).resolves.toBeUndefined();
  });
  it("surfaces the backend error string on failure", async () => {
    fetchMock(errJson(401, { error: "unauthorized" }));
    const err = (await accountApi.me().catch((e) => e)) as AccountError;
    expect(err).toBeInstanceOf(AccountError);
    expect(err.message).toBe("unauthorized");
    expect(err.status).toBe(401);
  });
  it("falls back to a status message when the payload has no error string", async () => {
    for (const payload of [{ error: 42 }, {}, null]) {
      fetchMock(errJson(403, payload));
      const err = (await accountApi.me().catch((e) => e)) as AccountError;
      expect(err.message).toBe("Request failed (HTTP 403)");
      expect(err.status).toBe(403);
    }
  });
  it("falls back to a status message when the body is not JSON", async () => {
    const fn = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("not json");
      },
    }) as unknown as Response);
    g.fetch = fn;
    const err = (await accountApi.me().catch((e) => e)) as AccountError;
    expect(err.message).toBe("Request failed (HTTP 500)");
  });
  it("propagates network throws", async () => {
    g.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(accountApi.me()).rejects.toThrow("fetch failed");
  });
  it("reports distinct statuses distinctly", async () => {
    for (const status of [400, 401, 404, 409, 422, 503]) {
      fetchMock(errJson(status, { error: `e${status}` }));
      const err = (await accountApi.me().catch((e) => e)) as AccountError;
      expect(err.status).toBe(status);
      expect(err.message).toBe(`e${status}`);
    }
  });
});
