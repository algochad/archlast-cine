import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { entryKey, getHistory, saveProgress, clearProgress } from "../history";
import type { WatchEntry } from "../history";

const KEY = "moviebox.watch.v1";

type Patch = Omit<WatchEntry, "updated">;

function patchOf(over: Partial<Patch> = {}): Patch {
  return {
    provider: "moviebox",
    id: "m1",
    title: "Title",
    poster: null,
    mediaType: "movie",
    year: null,
    season: 0,
    episode: 0,
    position: 10,
    duration: 100,
    ...over,
  };
}

function seed(entries: WatchEntry[]): void {
  const map: Record<string, WatchEntry> = {};
  for (const e of entries) map[`${e.provider}:${e.id}:${e.season}:${e.episode}`] = e;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

function storedMap(): Record<string, WatchEntry> {
  return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, WatchEntry>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("entryKey", () => {
  it("joins provider, id, season, and episode", () =>
    expect(entryKey("moviebox", "abc", 2, 7)).toBe("moviebox:abc:2:7"));
  it("defaults season and episode to zero", () =>
    expect(entryKey("moviebox", "abc")).toBe("moviebox:abc:0:0"));
  it("distinguishes seasons and episodes of the same title", () => {
    expect(entryKey("moviebox", "s1", 1, 1)).not.toBe(entryKey("moviebox", "s1", 1, 2));
    expect(entryKey("moviebox", "s1", 1, 1)).not.toBe(entryKey("moviebox", "s1", 2, 1));
  });
  it("distinguishes providers for the same id", () =>
    expect(entryKey("moviebox", "x")).not.toBe(entryKey("fourkhdhub", "x")));
  it("handles unicode and emoji ids", () =>
    expect(entryKey("moviebox", "日本語 🎬", 1, 2)).toBe("moviebox:日本語 🎬:1:2"));
  it("handles empty id strings without throwing", () =>
    expect(entryKey("moviebox", "")).toBe("moviebox::0:0"));
  it("keeps numeric-like ids verbatim", () =>
    expect(entryKey("moviebox", "123", 1, 2)).toBe("moviebox:123:1:2"));
});

describe("getHistory", () => {
  it("returns [] when nothing is stored", () => expect(getHistory()).toEqual([]));
  it("returns stored entries newest-first", () => {
    seed([
      { ...patchOf({ id: "a" }), updated: 5 },
      { ...patchOf({ id: "b" }), updated: 20 },
      { ...patchOf({ id: "c" }), updated: 10 },
    ]);
    expect(getHistory().map((e) => e.id)).toEqual(["b", "c", "a"]);
  });
  it("round-trips every field of an entry", () => {
    const full: WatchEntry = {
      ...patchOf({ id: "z", title: "日本語 🎬", poster: "https://img/x.jpg", year: "2024", season: 3, episode: 4, position: 42.5, duration: 3600 }),
      updated: 99,
    };
    seed([full]);
    expect(getHistory()).toEqual([full]);
  });
  it("returns [] for corrupt JSON instead of throwing", () => {
    window.localStorage.setItem(KEY, "[[[not json");
    expect(getHistory()).toEqual([]);
  });
  it("returns [] for JSON null instead of throwing", () => {
    window.localStorage.setItem(KEY, "null");
    expect(getHistory()).toEqual([]);
  });
  it("returns [] for a JSON number instead of throwing", () => {
    window.localStorage.setItem(KEY, "5");
    expect(getHistory()).toEqual([]);
  });
  it("returns [] for an empty map", () => {
    window.localStorage.setItem(KEY, "{}");
    expect(getHistory()).toEqual([]);
  });
});

describe("saveProgress", () => {
  it("creates a new entry stamped with the current time", () => {
    vi.spyOn(Date, "now").mockReturnValue(12345);
    saveProgress("moviebox:m1:0:0", patchOf());
    expect(getHistory()).toEqual([{ ...patchOf(), updated: 12345 }]);
  });
  it("merges a later patch over the previous row", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200);
    saveProgress("moviebox:m1:0:0", patchOf({ position: 10 }));
    saveProgress("moviebox:m1:0:0", patchOf({ position: 55 }));
    const all = getHistory();
    expect(all).toHaveLength(1);
    expect(all[0].position).toBe(55);
    expect(all[0].updated).toBe(200);
  });
  it("removes rows watched past 98 percent", () => {
    saveProgress("moviebox:m1:0:0", patchOf({ position: 10 }));
    saveProgress("moviebox:m1:0:0", patchOf({ position: 99, duration: 100 }));
    expect(getHistory()).toEqual([]);
    expect(storedMap()).toEqual({});
  });
  it("keeps rows at exactly 98 percent", () => {
    saveProgress("moviebox:m1:0:0", patchOf({ position: 98, duration: 100 }));
    expect(getHistory()).toHaveLength(1);
  });
  it("keeps unknown-duration rows regardless of position", () => {
    saveProgress("moviebox:m1:0:0", patchOf({ position: 5000, duration: 0 }));
    expect(getHistory()).toHaveLength(1);
  });
  it("caps the store at 50 entries, dropping the oldest", () => {
    const old: WatchEntry[] = Array.from({ length: 50 }, (_, i) => ({
      ...patchOf({ id: `old-${i}` }),
      updated: i + 1,
    }));
    seed(old);
    vi.spyOn(Date, "now").mockReturnValue(1000);
    saveProgress("moviebox:fresh:0:0", patchOf({ id: "fresh" }));
    const all = getHistory();
    expect(all).toHaveLength(50);
    expect(all.map((e) => e.id)).toContain("fresh");
    expect(all.map((e) => e.id)).not.toContain("old-0");
  });
  it("does not throw on corrupt pre-existing storage", () => {
    window.localStorage.setItem(KEY, "[[[not json");
    expect(() => saveProgress("moviebox:m1:0:0", patchOf())).not.toThrow();
  });
  it("degrades silently when storage quota is exceeded", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    expect(() => saveProgress("moviebox:m1:0:0", patchOf())).not.toThrow();
  });
});

describe("clearProgress", () => {
  it("removes the targeted entry", () => {
    seed([
      { ...patchOf({ id: "a" }), updated: 1 },
      { ...patchOf({ id: "b" }), updated: 2 },
    ]);
    clearProgress("moviebox:a:0:0");
    expect(getHistory().map((e) => e.id)).toEqual(["b"]);
  });
  it("keeps every other entry intact", () => {
    const keep: WatchEntry = { ...patchOf({ id: "keep", title: "Keep 🎬" }), updated: 3 };
    seed([keep, { ...patchOf({ id: "drop" }), updated: 4 }]);
    clearProgress("moviebox:drop:0:0");
    expect(getHistory()).toEqual([keep]);
  });
  it("is a no-op when storage is empty", () => {
    expect(() => clearProgress("moviebox:ghost:0:0")).not.toThrow();
    expect(getHistory()).toEqual([]);
  });
  it("is a no-op for unknown keys", () => {
    seed([{ ...patchOf({ id: "a" }), updated: 1 }]);
    clearProgress("moviebox:ghost:9:9");
    expect(getHistory()).toHaveLength(1);
  });
  it("does not throw on corrupt storage", () => {
    window.localStorage.setItem(KEY, "[[[not json");
    expect(() => clearProgress("moviebox:a:0:0")).not.toThrow();
  });
  it("handles unicode keys", () => {
    seed([{ ...patchOf({ id: "日本語 🎬" }), updated: 1 }]);
    clearProgress("moviebox:日本語 🎬:0:0");
    expect(getHistory()).toEqual([]);
  });
});
