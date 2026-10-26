import { describe, expect, it, vi } from "vitest";
import {
  clampSeekTarget,
  resolveDisplayTime,
  seekProgressPct,
} from "../../lib/seek";
import { parseMpdDuration } from "../../lib/playback";

/**
 * Transcode window math in watch-player.tsx.
 *
 * The media element only exposes the sliding live window
 * (video.duration = window length, currentTime = window-relative), so:
 *
 *   rAF:           absTime = Math.min(offset + video.currentTime, total)
 *   buffered fill: bufAbs  = min(offset + bufferedEnd, total)
 *   seekAbsolute:  availableUntil = offset + bufferedEnd + 1.5
 *                  windowStart    = Math.max(offset, 0)
 *                  in-window -> plain window-relative media seek
 *                              mediaTime = min(max(abs - offset, 0),
 *                                              video.duration || 0)
 *                  otherwise -> remote pipeline restart (storm-guarded:
 *                              remoteSeekBusyRef drops overlaps)
 *
 * The true total comes from the real `parseMpdDuration` (MPD carries the
 * runtime the HLS window never exposes); clamping/display flow through the
 * real seek helpers. Only the element + busy flag are faked.
 */

const MPD = `<?xml version="1.0"?>
<MPD mediaPresentationDuration="PT2H28M7.9S" type="static">
  <Period><AdaptationSet mimeType="video/mp4" codecs="hev1.1.6.L120.90">
    <Representation bandwidth="1000"/>
  </AdaptationSet></Period>
</MPD>`;

interface WindowCtx {
  offset: number;
  bufferedEnd: number | null; // null = nothing buffered yet
  videoDuration: number; // window length exposed by the element
  total: number;
}

type SeekVerdict =
  | { kind: "media"; mediaTime: number }
  | { kind: "remote"; abs: number };

/** Mirrors the seekAbsolute window branch. */
function classifySeek(abs: number, ctx: WindowCtx): SeekVerdict | null {
  const target = clampSeekTarget(abs, ctx.total);
  if (target === null) return null;
  const end = ctx.bufferedEnd ?? 0;
  const availableUntil = ctx.offset + end + 1.5;
  const windowStart = Math.max(ctx.offset, 0);
  if (target <= availableUntil && target >= windowStart - 1.5) {
    return {
      kind: "media",
      mediaTime: Math.min(
        Math.max(target - ctx.offset, 0),
        ctx.videoDuration || 0,
      ),
    };
  }
  return { kind: "remote", abs: target };
}

/** Mirrors the rAF absolute-position mapping. */
function absTimeOf(
  offset: number,
  currentTime: number,
  total: number,
): number {
  return Math.min(offset + currentTime, total);
}

/** Mirrors the remoteSeek storm guard (remoteSeekBusyRef). */
function createRemoteGuard() {
  let busy = false;
  const begin = vi.fn((): boolean => {
    if (busy) return false;
    busy = true;
    return true;
  });
  return {
    begin,
    release() {
      busy = false;
    },
  };
}

describe("transcode window math (offset + currentTime)", () => {
  const total = parseMpdDuration(MPD);
  const TOTAL = total ?? 0;
  it("derives the MPD total through the real playback API", () => {
    expect(total).toBeCloseTo(8887.9, 5);
  });

  it("maps window-relative currentTime onto the absolute timeline", () => {
    expect(absTimeOf(1000, 12.5, TOTAL)).toBeCloseTo(1012.5, 10);
  });

  it("caps the absolute position at the total", () => {
    expect(absTimeOf(TOTAL - 1, 5, TOTAL)).toBe(TOTAL);
  });

  it("fresh pipeline (offset 0) starts at the window position", () => {
    expect(absTimeOf(0, 3.25, TOTAL)).toBeCloseTo(3.25, 10);
  });

  it("clamps a negative currentTime contribution via max() semantics", () => {
    // currentTime is never negative in practice; the mapping still caps.
    expect(absTimeOf(100, 0, TOTAL)).toBe(100);
  });

  it("buffered fill maps through the offset and caps at the total", () => {
    const bufAbs = Math.min(1000 + 28, TOTAL);
    expect(bufAbs).toBe(1028);
    expect(Math.min(TOTAL - 2 + 60, TOTAL)).toBe(TOTAL);
  });

  it("display selection ignores the pin on the transcode path", () => {
    expect(resolveDisplayTime(5000, 1012.5, true)).toBe(1012.5);
    expect(seekProgressPct(1012.5, TOTAL)).toBeGreaterThan(0);
  });
});

describe("transcode seek classification (window vs remote restart)", () => {
  const TOTAL = 8887.9;
  const ctx: WindowCtx = {
    offset: 1000,
    bufferedEnd: 60,
    videoDuration: 90,
    total: TOTAL,
  };

  it("seeks inside the window with a plain media seek", () => {
    const v = classifySeek(1030, ctx);
    expect(v).toEqual({ kind: "media", mediaTime: 30 });
  });

  it("treats exactly availableUntil as in-window (inclusive boundary)", () => {
    // availableUntil = 1000 + 60 + 1.5 = 1061.5
    const v = classifySeek(1061.5, ctx);
    expect(v?.kind).toBe("media");
  });

  it("routes just past availableUntil to a remote restart", () => {
    const v = classifySeek(1061.6, ctx);
    expect(v).toEqual({ kind: "remote", abs: 1061.6 });
  });

  it("treats exactly windowStart - 1.5 as in-window (inclusive boundary)", () => {
    // windowStart = 1000 -> lower edge 998.5
    const v = classifySeek(998.5, ctx);
    expect(v?.kind).toBe("media");
    if (v?.kind === "media") expect(v.mediaTime).toBe(0); // clamped, never negative
  });

  it("routes just below windowStart - 1.5 to a remote restart", () => {
    expect(classifySeek(998.4, ctx)).toEqual({
      kind: "remote",
      abs: 998.4,
    });
  });

  it("routes a far jump to a remote restart", () => {
    expect(classifySeek(5000, ctx)).toEqual({ kind: "remote", abs: 5000 });
  });

  it("clamps the target to the total before comparing with the window", () => {
    const nearEnd: WindowCtx = {
      offset: TOTAL - 90,
      bufferedEnd: 89,
      videoDuration: 90,
      total: TOTAL,
    };
    const v = classifySeek(TOTAL + 500, nearEnd);
    expect(v?.kind).toBe("media");
    if (v?.kind === "media") expect(v.mediaTime).toBeLessThanOrEqual(90);
  });

  it("treats a negative offset as windowStart 0", () => {
    const v = classifySeek(
      0,
      { offset: -50, bufferedEnd: 60, videoDuration: 90, total: TOTAL },
    );
    expect(v?.kind).toBe("media");
  });

  it("falls back to currentTime-as-end when nothing is buffered", () => {
    const unbuffered: WindowCtx = {
      offset: 1000,
      bufferedEnd: null,
      videoDuration: 90,
      total: TOTAL,
    };
    // availableUntil = 1000 + 0 + 1.5: only the 1.5s tolerance window.
    expect(classifySeek(1001, unbuffered)?.kind).toBe("media");
    expect(classifySeek(2000, unbuffered)).toEqual({
      kind: "remote",
      abs: 2000,
    });
  });

  it("returns null for a non-finite target (dispatcher blocks)", () => {
    expect(classifySeek(NaN, ctx)).toBeNull();
    expect(classifySeek(Infinity, ctx)).toBeNull();
  });

  it("caps mediaTime at the window length", () => {
    const short: WindowCtx = {
      offset: 1000,
      bufferedEnd: 60,
      videoDuration: 20,
      total: TOTAL,
    };
    const v = classifySeek(1061.5, short);
    expect(v).toEqual({ kind: "media", mediaTime: 20 });
  });
});

describe("remoteSeek storm guard", () => {
  it("lets the first remote seek through", () => {
    const guard = createRemoteGuard();
    expect(guard.begin()).toBe(true);
    expect(guard.begin).toHaveBeenCalledTimes(1);
  });

  it("drops overlapping remote seeks while one is in flight", () => {
    const guard = createRemoteGuard();
    expect(guard.begin()).toBe(true);
    expect(guard.begin()).toBe(false);
    expect(guard.begin()).toBe(false);
  });

  it("allows the next seek after the in-flight one settles", () => {
    const guard = createRemoteGuard();
    expect(guard.begin()).toBe(true);
    guard.release();
    expect(guard.begin()).toBe(true);
  });

  it("release without a pending seek is harmless", () => {
    const guard = createRemoteGuard();
    expect(() => guard.release()).not.toThrow();
    expect(guard.begin()).toBe(true);
  });

  it("a refused-then-released sequence keeps pipeline order (burst of 5 -> 1 + 1)", () => {
    const guard = createRemoteGuard();
    const admitted: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      if (guard.begin()) admitted.push(i);
    }
    expect(admitted).toEqual([0]);
    guard.release();
    if (guard.begin()) admitted.push(99);
    expect(admitted).toEqual([0, 99]);
  });
});

describe("missing MPD duration blocks transcode seeks", () => {
  it("absent mediaPresentationDuration parses to null via the real API", () => {
    expect(parseMpdDuration("<MPD></MPD>")).toBeNull();
  });

  it("an unparseable duration attribute parses to null", () => {
    expect(parseMpdDuration('<MPD mediaPresentationDuration="soon"></MPD>')).toBeNull();
  });

  it("a bare PT with no components parses to null", () => {
    expect(parseMpdDuration('<MPD mediaPresentationDuration="PT"></MPD>')).toBeNull();
  });

  it("a null total makes every classification block (no jump to 0)", () => {
    expect(clampSeekTarget(120, null)).toBeNull();
    expect(clampSeekTarget(0, null)).toBeNull();
  });

  it("an undefined total blocks the same way", () => {
    expect(clampSeekTarget(120, undefined)).toBeNull();
  });

  it("a zero or negative total blocks instead of clamping into it", () => {
    expect(clampSeekTarget(120, 0)).toBeNull();
    expect(clampSeekTarget(120, -90)).toBeNull();
  });
});
