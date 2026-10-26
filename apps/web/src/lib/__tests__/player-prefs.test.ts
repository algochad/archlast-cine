import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_PLAYER_PREFS,
  getPrefs,
  setPrefs,
  subscribePrefs,
  extractSyncSubset,
  PLAYER_PREFS_KEY,
  PLAYER_PREFS_SEEDED_KEY,
  SYNC_KEYS,
  _resetListeners,
} from "../player-prefs";
import { DEFAULT_SUB_STYLE } from "../sub-style";

const LS_KEY = PLAYER_PREFS_KEY;

beforeEach(() => {
  window.localStorage.clear();
  _resetListeners();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  _resetListeners();
});

describe("DEFAULT_PLAYER_PREFS", () => {
  it("matches verbatim spec values (09 section 9.1)", () => {
    expect(DEFAULT_PLAYER_PREFS.seekStep).toBe(10);
    expect(DEFAULT_PLAYER_PREFS.timeMode).toBe("elapsed");
    expect(DEFAULT_PLAYER_PREFS.playbackRate).toBe(1);
    expect(DEFAULT_PLAYER_PREFS.pitchLock).toBe(true);
    expect(DEFAULT_PLAYER_PREFS.smartSpeed).toBe(false);
    expect(DEFAULT_PLAYER_PREFS.holdBoostRate).toBe(2);
    expect(DEFAULT_PLAYER_PREFS.volume).toBe(1);
    expect(DEFAULT_PLAYER_PREFS.muted).toBe(false);
    expect(DEFAULT_PLAYER_PREFS.volumeBoost).toBe(false);
    expect(DEFAULT_PLAYER_PREFS.normalize).toBe(false);
    expect(DEFAULT_PLAYER_PREFS.brightness).toBe(1);
    expect(DEFAULT_PLAYER_PREFS.aspectMode).toBe("contain");
    expect(DEFAULT_PLAYER_PREFS.filter).toBe("none");
    expect(DEFAULT_PLAYER_PREFS.nightDim).toBe(0);
    expect(DEFAULT_PLAYER_PREFS.autoplay).toBe(true);
    expect(DEFAULT_PLAYER_PREFS.autoplayDelay).toBe(10);
    expect(DEFAULT_PLAYER_PREFS.prefSubLang).toEqual(["en"]);
    expect(DEFAULT_PLAYER_PREFS.prefAudioLang).toEqual(["ja", "en"]);
    expect(DEFAULT_PLAYER_PREFS.prefForced).toBe(true);
    expect(DEFAULT_PLAYER_PREFS.preferSDH).toBe(false);
    expect(DEFAULT_PLAYER_PREFS.dualSubs).toBe(false);
    expect(DEFAULT_PLAYER_PREFS.subOffsetMs).toBe(0);
    expect(DEFAULT_PLAYER_PREFS.subOffsetMs2).toBe(0);
    expect(DEFAULT_PLAYER_PREFS.subStyle).toEqual(DEFAULT_SUB_STYLE);
    expect(DEFAULT_PLAYER_PREFS.subFilter).toBe("all");
    expect(DEFAULT_PLAYER_PREFS.backBuffer).toBe(30);
    expect(DEFAULT_PLAYER_PREFS.lastBps).toBe(2_000_000);
    expect(DEFAULT_PLAYER_PREFS.parallelMp4).toBe(false);
    expect(DEFAULT_PLAYER_PREFS.statsOpen).toBe(false);
  });

  it("uses moviebox.prefs.v1 key", () => {
    expect(PLAYER_PREFS_KEY).toBe("moviebox.prefs.v1");
  });

  it("uses correct seeded key", () => {
    expect(PLAYER_PREFS_SEEDED_KEY).toBe("moviebox.prefs.seeded");
  });

  it("has exactly 29 owned keys and no locked", () => {
    expect(Object.keys(DEFAULT_PLAYER_PREFS)).toHaveLength(29);
    expect("locked" in DEFAULT_PLAYER_PREFS).toBe(false);
  });
});

describe("getPrefs", () => {
  it("returns defaults when localStorage is empty", () => {
    expect(getPrefs()).toEqual(DEFAULT_PLAYER_PREFS);
  });

  it("returns defaults when localStorage has no key", () => {
    window.localStorage.removeItem(LS_KEY);
    expect(getPrefs()).toEqual(DEFAULT_PLAYER_PREFS);
  });

  it("returns defaults on corrupt JSON", () => {
    window.localStorage.setItem(LS_KEY, "{ not json");
    expect(getPrefs()).toEqual(DEFAULT_PLAYER_PREFS);
  });

  it("returns defaults on JSON array root", () => {
    window.localStorage.setItem(LS_KEY, "[]");
    expect(getPrefs()).toEqual(DEFAULT_PLAYER_PREFS);
  });

  it("returns defaults on JSON null root", () => {
    window.localStorage.setItem(LS_KEY, "null");
    expect(getPrefs()).toEqual(DEFAULT_PLAYER_PREFS);
  });

  it("merges partial stored object over defaults", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ seekStep: 30 }));
    const prefs = getPrefs();
    expect(prefs.seekStep).toBe(30);
    expect(prefs.playbackRate).toBe(DEFAULT_PLAYER_PREFS.playbackRate);
    expect(prefs.autoplay).toBe(DEFAULT_PLAYER_PREFS.autoplay);
    expect(prefs.prefSubLang).toEqual(DEFAULT_PLAYER_PREFS.prefSubLang);
  });

  it("coerces invalid seekStep to 10 via resolveSeekStep", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ seekStep: 99 }));
    expect(getPrefs().seekStep).toBe(10);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ seekStep: "bogus" }));
    expect(getPrefs().seekStep).toBe(10);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ seekStep: null }));
    expect(getPrefs().seekStep).toBe(10);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ seekStep: 5 }));
    expect(getPrefs().seekStep).toBe(5);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ seekStep: 60 }));
    expect(getPrefs().seekStep).toBe(60);
  });

  it("coerces invalid playbackRate via clampRate", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ playbackRate: NaN }));
    expect(getPrefs().playbackRate).toBe(1);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ playbackRate: Infinity }));
    expect(getPrefs().playbackRate).toBe(1);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ playbackRate: 999 }));
    expect(getPrefs().playbackRate).toBe(3);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ playbackRate: -5 }));
    expect(getPrefs().playbackRate).toBe(0.25);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ playbackRate: 1.75 }));
    expect(getPrefs().playbackRate).toBe(1.75);
  });

  it("coerces boolean fields from non-booleans to defaults", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ autoplay: "yes", pitchLock: 1 }));
    const p = getPrefs();
    expect(p.autoplay).toBe(DEFAULT_PLAYER_PREFS.autoplay);
    expect(p.pitchLock).toBe(DEFAULT_PLAYER_PREFS.pitchLock);
  });

  it("coerces volume and brightness within bounds", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ volume: 5, brightness: -1 }));
    const p = getPrefs();
    expect(p.volume).toBe(1);
    expect(p.brightness).toBe(0.3);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ volume: "not-a-number" }));
    expect(getPrefs().volume).toBe(DEFAULT_PLAYER_PREFS.volume);
  });

  it("coerces backBuffer invalid to default 30", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ backBuffer: 99 }));
    expect(getPrefs().backBuffer).toBe(30);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ backBuffer: 0 }));
    expect(getPrefs().backBuffer).toBe(0);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ backBuffer: 15 }));
    expect(getPrefs().backBuffer).toBe(15);
  });

  it("coerces prefSubLang invalid to defaults", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ prefSubLang: "en" }));
    expect(getPrefs().prefSubLang).toEqual(DEFAULT_PLAYER_PREFS.prefSubLang);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ prefSubLang: [123, null] }));
    expect(getPrefs().prefSubLang).toEqual(DEFAULT_PLAYER_PREFS.prefSubLang);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ prefSubLang: ["fr", "de"] }));
    expect(getPrefs().prefSubLang).toEqual(["fr", "de"]);
  });

  it("coerces subStyle invalid to defaults transparently", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ subStyle: "garbage" }));
    expect(getPrefs().subStyle).toEqual(DEFAULT_SUB_STYLE);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ subStyle: { font: "bad", scale: 999 } }));
    const s = getPrefs().subStyle;
    expect(s.font).toBe(DEFAULT_SUB_STYLE.font);
    expect(s.scale).toBe(2); // clamped max
  });

  it("coerces timeMode and aspectMode invalid to defaults", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ timeMode: "bad", aspectMode: "bad" }));
    const p = getPrefs();
    expect(p.timeMode).toBe("elapsed");
    expect(p.aspectMode).toBe("contain");
  });

  it("clones defaults so mutations don't leak", () => {
    const a = getPrefs();
    a.prefSubLang.push("mutated");
    const b = getPrefs();
    expect(b.prefSubLang).toEqual(["en"]);
  });
});

describe("setPrefs", () => {
  it("persists patch and survives reload (anon prefs survive reload)", () => {
    setPrefs({ seekStep: 30, autoplay: false });
    const reloaded = getPrefs();
    expect(reloaded.seekStep).toBe(30);
    expect(reloaded.autoplay).toBe(false);
    expect(reloaded.playbackRate).toBe(DEFAULT_PLAYER_PREFS.playbackRate);
  });

  it("merges patch over current stored prefs", () => {
    setPrefs({ seekStep: 15 });
    setPrefs({ playbackRate: 1.5 });
    const p = getPrefs();
    expect(p.seekStep).toBe(15);
    expect(p.playbackRate).toBe(1.5);
  });

  it("coerces patch values via same validators", () => {
    const p = setPrefs({ seekStep: 999 as unknown as 5, playbackRate: NaN });
    expect(p.seekStep).toBe(10);
    expect(p.playbackRate).toBe(1);
  });

  it("never persists locked (session-only)", () => {
    setPrefs({ locked: true } as unknown as Partial<import("../player-prefs").PlayerPrefs>);
    const raw = window.localStorage.getItem(LS_KEY)!;
    expect(raw).not.toContain("locked");
    expect((getPrefs() as unknown as Record<string, unknown>).locked).toBeUndefined();
  });

  it("returns the merged, coerced prefs", () => {
    const ret = setPrefs({ seekStep: 60, volume: 0.5 });
    expect(ret.seekStep).toBe(60);
    expect(ret.volume).toBe(0.5);
    expect(ret).toEqual(getPrefs());
  });

  it("writes JSON with all keys (no sparse object)", () => {
    setPrefs({ seekStep: 5 });
    const parsed = JSON.parse(window.localStorage.getItem(LS_KEY)!);
    expect(parsed.seekStep).toBe(5);
    expect(parsed.playbackRate).toBeDefined();
    expect(parsed.subStyle).toBeDefined();
  });

  it("degrades silently when localStorage quota exceeded", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => setPrefs({ seekStep: 15 })).not.toThrow();
    spy.mockRestore();
  });

  it("overwrites corrupt JSON on next setPrefs", () => {
    window.localStorage.setItem(LS_KEY, "{ corrupt");
    setPrefs({ seekStep: 30 });
    expect(getPrefs().seekStep).toBe(30);
  });
});

describe("subscribePrefs", () => {
  it("notifies subscriber on setPrefs", () => {
    const fn = vi.fn();
    const unsub = subscribePrefs(fn);
    setPrefs({ seekStep: 15 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].seekStep).toBe(15);
    unsub();
  });

  it("unsubscribes correctly", () => {
    const fn = vi.fn();
    const unsub = subscribePrefs(fn);
    unsub();
    setPrefs({ seekStep: 30 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    const ua = subscribePrefs(a);
    const ub = subscribePrefs(b);
    setPrefs({ autoplay: false });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    ua();
    setPrefs({ autoplay: true });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    ub();
  });

  it("isolates subscriber errors", () => {
    const bad = vi.fn(() => { throw new Error("oops"); });
    const good = vi.fn();
    subscribePrefs(bad);
    subscribePrefs(good);
    expect(() => setPrefs({ seekStep: 60 })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe("extractSyncSubset", () => {
  it("extracts exactly the 7 sync keys", () => {
    expect(SYNC_KEYS).toEqual(["seekStep", "playbackRate", "autoplay", "prefSubLang", "prefAudioLang", "subStyle", "aspectMode"]);
  });

  it("returns only sync subset with cloned arrays/objects", () => {
    const prefs = getPrefs();
    prefs.seekStep = 30;
    prefs.prefSubLang = ["fr"];
    const subset = extractSyncSubset(prefs);
    expect(Object.keys(subset).sort()).toEqual([...SYNC_KEYS].sort());
    expect(subset.seekStep).toBe(30);
    expect(subset.prefSubLang).toEqual(["fr"]);
    // mutation of source doesn't affect snapshot, and vice versa
    subset.prefSubLang.push("mutated");
    expect(prefs.prefSubLang).toEqual(["fr"]);
  });

  it("sync subset never includes device-local keys", () => {
    const subset = extractSyncSubset(getPrefs());
    expect((subset as Record<string, unknown>).volume).toBeUndefined();
    expect((subset as Record<string, unknown>).brightness).toBeUndefined();
    expect((subset as Record<string, unknown>).statsOpen).toBeUndefined();
    expect((subset as Record<string, unknown>).lastBps).toBeUndefined();
    expect((subset as Record<string, unknown>).locked).toBeUndefined();
  });

  it("subStyle in subset is a copy", () => {
    const prefs = getPrefs();
    const subset = extractSyncSubset(prefs);
    subset.subStyle.color = "#ff0000";
    expect(prefs.subStyle.color).toBe(DEFAULT_SUB_STYLE.color);
  });
});
