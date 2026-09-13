import { describe, it, expect, vi } from "vitest";
import type { SessionState, MyListState, HistoryApi } from "../session-contract";
import type { MediaType } from "../media-types";

// session-contract.ts exports interfaces only (no runtime functions): each
// suite builds a conforming stub so a drifted auth-agent contract fails at
// typecheck time, then exercises the stub's observable behavior.

function sessionStub(over: Partial<SessionState> = {}): SessionState {
  return {
    user: null,
    settings: { region: "us", provider: "moviebox" },
    status: "anon",
    refresh: async () => {},
    login: async () => {},
    register: async () => {},
    logout: async () => {},
    updateSettings: async () => {},
    ...over,
  };
}

describe("SessionState", () => {
  it("constructs an anonymous session with defaults", () => {
    const s = sessionStub();
    expect(s.user).toBeNull();
    expect(s.status).toBe("anon");
    expect(s.settings).toEqual({ region: "us", provider: "moviebox" });
  });
  it("constructs an authenticated session with a user", () => {
    const s = sessionStub({
      user: { id: 1, email: "a@example.com", name: "Ada" },
      status: "authed",
    });
    expect(s.user?.email).toBe("a@example.com");
  });
  it("covers all three lifecycle statuses", () => {
    for (const status of ["loading", "anon", "authed"] as const) {
      expect(sessionStub({ status }).status).toBe(status);
    }
  });
  it("login delegates credentials to the auth agent", async () => {
    const login = vi.fn(async () => {});
    const s = sessionStub({ login });
    await s.login("a@example.com", "s3cret 日本語 🎬");
    expect(login).toHaveBeenCalledWith("a@example.com", "s3cret 日本語 🎬");
  });
  it("register forwards name, email, and password in order", async () => {
    const register = vi.fn(async () => {});
    const s = sessionStub({ register });
    await s.register("Ada", "a@example.com", "pw");
    expect(register).toHaveBeenCalledWith("Ada", "a@example.com", "pw");
  });
  it("logout and refresh resolve without a value", async () => {
    const s = sessionStub();
    await expect(s.logout()).resolves.toBeUndefined();
    await expect(s.refresh()).resolves.toBeUndefined();
  });
  it("updateSettings forwards a partial patch", async () => {
    const updateSettings = vi.fn(async () => {});
    const s = sessionStub({ updateSettings });
    await s.updateSettings({ region: "ph" });
    expect(updateSettings).toHaveBeenCalledWith({ region: "ph" });
  });
  it("propagates auth failures to the caller", async () => {
    const s = sessionStub({
      login: async () => {
        throw new Error("bad credentials");
      },
    });
    await expect(s.login("a", "b")).rejects.toThrow("bad credentials");
  });
});

describe("MyListState", () => {
  const listItem = {
    provider: "moviebox",
    id: "m1",
    title: "Title",
    poster: null as string | null,
    mediaType: "movie" as MediaType,
    year: null as string | null,
  };
  function listStub(over: Partial<MyListState> = {}): MyListState {
    return {
      ids: new Set<string>(),
      items: [],
      ready: true,
      toggle: async () => {},
      has: () => false,
      ...over,
    };
  }
  it("starts empty and ready", () => {
    const l = listStub();
    expect(l.ids.size).toBe(0);
    expect(l.items).toEqual([]);
    expect(l.ready).toBe(true);
  });
  it("has() resolves membership by provider+id", () => {
    const l = listStub({
      ids: new Set(["moviebox:m1"]),
      has: (provider, id) => provider === "moviebox" && id === "m1",
    });
    expect(l.has("moviebox", "m1")).toBe(true);
    expect(l.has("moviebox", "other")).toBe(false);
    expect(l.has("fourkhdhub", "m1")).toBe(false);
  });
  it("toggle() forwards the full item payload", async () => {
    const toggle = vi.fn(async () => {});
    const l = listStub({ toggle });
    await l.toggle(listItem);
    expect(toggle).toHaveBeenCalledWith(listItem);
  });
  it("toggle() accepts unicode titles", async () => {
    const toggle = vi.fn(async () => {});
    const l = listStub({ toggle });
    await l.toggle({ ...listItem, title: "日本語 🎬" });
    expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ title: "日本語 🎬" }));
  });
  it("toggle() accepts all three media types", async () => {
    const toggle = vi.fn(async () => {});
    const l = listStub({ toggle });
    for (const mediaType of ["movie", "series", "anime"] as MediaType[]) {
      await l.toggle({ ...listItem, mediaType });
    }
    expect(toggle).toHaveBeenCalledTimes(3);
  });
  it("propagates toggle failures", async () => {
    const l = listStub({
      toggle: async () => {
        throw new Error("offline");
      },
    });
    await expect(l.toggle(listItem)).rejects.toThrow("offline");
  });
});

describe("HistoryApi", () => {
  const recordEntry = {
    provider: "moviebox",
    id: "h1",
    title: "Title",
    poster: null as string | null,
    mediaType: "series" as MediaType,
    season: 2,
    episode: 7,
    position: 42.5,
    duration: 1500,
    year: "2024",
  };
  function historyStub(over: Partial<HistoryApi> = {}): HistoryApi {
    return {
      record: async () => {},
      remove: async () => {},
      ...over,
    };
  }
  it("record() forwards the full entry", async () => {
    const record = vi.fn(async () => {});
    await historyStub({ record }).record(recordEntry);
    expect(record).toHaveBeenCalledWith(recordEntry);
  });
  it("record() accepts unicode titles and fractional positions", async () => {
    const record = vi.fn(async () => {});
    const entry = { ...recordEntry, title: "日本語 🎬", position: 12.345 };
    await historyStub({ record }).record(entry);
    expect(record).toHaveBeenCalledWith(entry);
  });
  it("record() accepts zero season/episode for movies", async () => {
    const record = vi.fn(async () => {});
    await historyStub({ record }).record({ ...recordEntry, season: 0, episode: 0 });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ season: 0, episode: 0 }));
  });
  it("remove() forwards provider, id, season, and episode", async () => {
    const remove = vi.fn(async () => {});
    await historyStub({ remove }).remove("moviebox", "h1", 2, 7);
    expect(remove).toHaveBeenCalledWith("moviebox", "h1", 2, 7);
  });
  it("remove() tolerates omitted season/episode", async () => {
    const remove = vi.fn(async () => {});
    await historyStub({ remove }).remove("moviebox", "h1");
    expect(remove).toHaveBeenCalledWith("moviebox", "h1");
  });
  it("propagates record failures", async () => {
    const api = historyStub({
      record: async () => {
        throw new Error("quota exceeded");
      },
    });
    await expect(api.record(recordEntry)).rejects.toThrow("quota exceeded");
  });
});
