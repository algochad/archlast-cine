import { describe, it, expect } from "vitest";
import { entryKey, mergeEntries } from "../history-merge";
import type { WatchEntry } from "../account";

let n = 0;

function entry(over: Partial<WatchEntry> = {}): WatchEntry {
  n += 1;
  return {
    provider: "moviebox",
    id: `h${n}`,
    title: `Title ${n}`,
    poster: null,
    mediaType: "movie",
    year: null,
    season: 0,
    episode: 0,
    position: 10,
    duration: 100,
    updatedAt: 1000 + n,
    ...over,
  };
}

describe("entryKey", () => {
  it("joins provider, id, season, and episode", () =>
    expect(entryKey("moviebox", "abc", 2, 7)).toBe("moviebox:abc:2:7"));
  it("defaults season and episode to zero", () =>
    expect(entryKey("moviebox", "abc")).toBe("moviebox:abc:0:0"));
  it("distinguishes episodes of the same title", () =>
    expect(entryKey("p", "i", 1, 1)).not.toBe(entryKey("p", "i", 1, 2)));
  it("handles unicode ids", () =>
    expect(entryKey("moviebox", "日本語 🎬")).toBe("moviebox:日本語 🎬:0:0"));
  it("handles empty segments", () => expect(entryKey("", "")).toBe("::0:0"));
  it("matches the history-store key format", () =>
    expect(entryKey("fourkhdhub", "v", 0, 0)).toBe("fourkhdhub:v:0:0"));
});

describe("mergeEntries", () => {
  it("returns [] for two empty inputs", () => expect(mergeEntries([], [])).toEqual([]));
  it("keeps distinct keys from both sources", () => {
    const s = entry({ id: "server-only" });
    const l = entry({ id: "local-only" });
    const merged = mergeEntries([s], [l]);
    expect(merged.map((e) => e.id).sort()).toEqual(["local-only", "server-only"]);
  });
  it("lets a strictly newer server row win", () => {
    const server = entry({ id: "same", position: 80, updatedAt: 200 });
    const local = entry({ id: "same", position: 10, updatedAt: 100 });
    const merged = mergeEntries([server], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].position).toBe(80);
  });
  it("lets a strictly newer local row win (recency, not source)", () => {
    const server = entry({ id: "same", position: 10, updatedAt: 100 });
    const local = entry({ id: "same", position: 80, updatedAt: 200 });
    const merged = mergeEntries([server], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].position).toBe(80);
  });
  it("resolves timestamp ties toward the local row", () => {
    const server = entry({ id: "same", position: 10, updatedAt: 150 });
    const local = entry({ id: "same", position: 20, updatedAt: 150 });
    expect(mergeEntries([server], [local])[0].position).toBe(20);
  });
  it("sorts the merged list newest-first", () => {
    const a = entry({ id: "a", updatedAt: 10 });
    const b = entry({ id: "b", updatedAt: 30 });
    const c = entry({ id: "c", updatedAt: 20 });
    expect(mergeEntries([a, c], [b]).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });
  it("treats a missing updatedAt as zero", () => {
    const server = { ...entry({ id: "same", position: 1 }), updatedAt: undefined as unknown as number };
    const local = entry({ id: "same", position: 2, updatedAt: 5 });
    expect(mergeEntries([server], [local])[0].position).toBe(2);
  });
  it("keeps same-id rows from different providers apart", () => {
    const s = entry({ provider: "moviebox", id: "x" });
    const l = entry({ provider: "addons", id: "x" });
    expect(mergeEntries([s], [l])).toHaveLength(2);
  });
  it("keeps season/episode variants apart", () => {
    const s = entry({ id: "show", season: 1, episode: 1 });
    const l = entry({ id: "show", season: 1, episode: 2 });
    expect(mergeEntries([s], [l])).toHaveLength(2);
  });
  it("preserves unicode titles through the merge", () => {
    const s = entry({ id: "u", title: "日本語 🎬" });
    expect(mergeEntries([s], [])[0].title).toBe("日本語 🎬");
  });
});
