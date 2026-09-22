import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SERVER_SYNC_INTERVAL_MS,
  setWatchSyncTransport,
  syncDue,
  recordWatch,
  removeWatch,
} from "../watch-sync";
import type { WatchProgress, WatchSyncTransport } from "../watch-sync";
import { saveProgress, clearProgress } from "@/lib/history";

vi.mock("@/lib/history", () => ({
  entryKey: (p: string, id: string, s = 0, e = 0) => `${p}:${id}:${s}:${e}`,
  saveProgress: vi.fn(),
  clearProgress: vi.fn(),
}));

const saveMock = vi.mocked(saveProgress);
const clearMock = vi.mocked(clearProgress);

let n = 0;

function freshPatch(over: Partial<WatchProgress> = {}): WatchProgress {
  n += 1;
  return {
    provider: "moviebox",
    id: `w${n}`,
    title: `Title ${n}`,
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

function makeTransport(): WatchSyncTransport & { recorded: WatchProgress[]; removed: string[] } {
  const t: WatchSyncTransport & { recorded: WatchProgress[]; removed: string[] } = {
    recorded: [],
    removed: [],
    record: (p) => {
      t.recorded.push(p);
    },
    remove: (provider, id, season, episode) => {
      t.removed.push(`${provider}:${id}:${season}:${episode}`);
    },
  };
  return t;
}

beforeEach(() => {
  vi.clearAllMocks();
  setWatchSyncTransport(null);
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
});

afterEach(() => {
  setWatchSyncTransport(null);
  vi.restoreAllMocks();
});

describe("SERVER_SYNC_INTERVAL_MS", () => {
  it("is eight seconds", () => expect(SERVER_SYNC_INTERVAL_MS).toBe(8000));
  it("is a positive finite number", () => {
    expect(Number.isFinite(SERVER_SYNC_INTERVAL_MS)).toBe(true);
    expect(SERVER_SYNC_INTERVAL_MS).toBeGreaterThan(0);
  });
});

describe("syncDue", () => {
  it("returns true when nothing synced yet", () =>
    expect(syncDue(undefined, 1_000_000)).toBe(true));
  it("returns true exactly at the interval boundary", () =>
    expect(syncDue(1_000_000 - 8000, 1_000_000)).toBe(true));
  it("returns true past the interval", () =>
    expect(syncDue(1_000_000 - 8001, 1_000_000)).toBe(true));
  it("returns false just inside the interval", () =>
    expect(syncDue(1_000_000 - 7999, 1_000_000)).toBe(false));
  it("returns false for a same-instant tick", () =>
    expect(syncDue(1_000_000, 1_000_000)).toBe(false));
  it("returns false when the last sync is in the future", () =>
    expect(syncDue(1_000_001, 1_000_000)).toBe(false));
  it("force bypasses the throttle", () => {
    expect(syncDue(1_000_000, 1_000_000, true)).toBe(true);
    expect(syncDue(undefined, 1_000_000, true)).toBe(true);
  });
});

describe("recordWatch", () => {
  it("always writes locally, even when anonymous", () => {
    const p = freshPatch();
    recordWatch(p, false);
    expect(saveMock).toHaveBeenCalledOnce();
    expect(saveMock).toHaveBeenCalledWith(`moviebox:${p.id}:0:0`, p);
  });
  it("pushes to the server transport when signed in", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    const p = freshPatch();
    recordWatch(p, true);
    expect(t.recorded).toEqual([p]);
  });
  it("stays local-only when anonymous despite a wired transport", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    recordWatch(freshPatch(), false);
    expect(t.recorded).toEqual([]);
  });
  it("stays local-only when no transport is wired", () => {
    recordWatch(freshPatch(), true);
    expect(saveMock).toHaveBeenCalledOnce();
  });
  it("throttles a rapid second tick for the same title", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    const p = freshPatch();
    recordWatch(p, true);
    recordWatch({ ...p, position: 11 }, true);
    expect(t.recorded).toHaveLength(1);
    expect(saveMock).toHaveBeenCalledTimes(2);
  });
  it("force flush bypasses the throttle (pause / unmount)", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    const p = freshPatch();
    recordWatch(p, true);
    recordWatch({ ...p, position: 11 }, true, true);
    expect(t.recorded).toHaveLength(2);
  });
  it("syncs again once the interval elapses", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    const now = vi.mocked(Date.now);
    const p = freshPatch();
    recordWatch(p, true);
    now.mockReturnValue(1_000_000 + 8000);
    recordWatch({ ...p, position: 12 }, true);
    expect(t.recorded).toHaveLength(2);
  });
  it("throttles per title, not globally", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    recordWatch(freshPatch(), true);
    recordWatch(freshPatch(), true);
    expect(t.recorded).toHaveLength(2);
  });
  it("removes the server row instead of upserting a finished title", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    const p = freshPatch({ position: 99, duration: 100 });
    recordWatch(p, true);
    expect(t.recorded).toEqual([]);
    expect(t.removed).toEqual([`moviebox:${p.id}:0:0`]);
    expect(clearMock).toHaveBeenCalledWith(`moviebox:${p.id}:0:0`);
  });
  it("keeps a 98-percent row as an upsert, not a removal", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    recordWatch(freshPatch({ position: 98, duration: 100 }), true);
    expect(t.recorded).toHaveLength(1);
    expect(t.removed).toEqual([]);
  });
  it("does not treat unknown-duration rows as finished", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    recordWatch(freshPatch({ position: 5000, duration: 0 }), true);
    expect(t.recorded).toHaveLength(1);
    expect(t.removed).toEqual([]);
  });
});

describe("removeWatch", () => {
  it("always clears the local row, even when anonymous", () => {
    removeWatch("moviebox", "x", 1, 2, false);
    expect(clearMock).toHaveBeenCalledWith("moviebox:x:1:2");
  });
  it("notifies the transport when signed in", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    removeWatch("moviebox", "x", 1, 2, true);
    expect(t.removed).toEqual(["moviebox:x:1:2"]);
  });
  it("stays local-only when anonymous despite a wired transport", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    removeWatch("moviebox", "x", 0, 0, false);
    expect(t.removed).toEqual([]);
    expect(clearMock).toHaveBeenCalledOnce();
  });
  it("stays local-only when no transport is wired", () => {
    expect(() => removeWatch("moviebox", "x", 0, 0, true)).not.toThrow();
    expect(clearMock).toHaveBeenCalledOnce();
  });
  it("defaults season and episode to zero", () => {
    removeWatch("moviebox", "x");
    expect(clearMock).toHaveBeenCalledWith("moviebox:x:0:0");
  });
  it("resets the throttle so the next tick syncs immediately", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    const p = freshPatch();
    recordWatch(p, true);
    removeWatch(p.provider, p.id, p.season, p.episode, true);
    recordWatch({ ...p, position: 20 }, true);
    expect(t.recorded).toHaveLength(2);
  });
  it("unwiring the transport stops server writes", () => {
    const t = makeTransport();
    setWatchSyncTransport(t);
    setWatchSyncTransport(null);
    recordWatch(freshPatch(), true);
    expect(t.recorded).toEqual([]);
  });
});
