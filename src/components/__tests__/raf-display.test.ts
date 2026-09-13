import { describe, expect, it } from "vitest";
import {
  isSeekableDuration,
  resolveDisplayTime,
  seekProgressPct,
} from "../../lib/seek";

/**
 * Locks the rAF progress-tick display selection in watch-player.tsx:
 *
 *   const pending = pendingSeekRef.current;
 *   const displayTime = pending != null && !transcode ? pending : absTime;
 *   const pct = duration > 0 ? (displayTime / duration) * 100 : 0;
 *
 * expressed through the shared helpers. The pin holds the thumb during a
 * direct seek (no rubberband snap-back); on the transcode path the pin is
 * ignored because the pipeline restart owns the timeline.
 */
function frameDisplay(opts: {
  pending: number | null;
  absTime: number;
  transcode: boolean;
  duration: number;
}): { displayTime: number; pct: number } {
  const displayTime = resolveDisplayTime(
    opts.pending,
    opts.absTime,
    opts.transcode,
  );
  return { displayTime, pct: seekProgressPct(displayTime, opts.duration) };
}

describe("rAF display selection (pending pin vs live absTime)", () => {
  it("pins the thumb at the seek target while a direct seek is in flight", () => {
    const f = frameDisplay({
      pending: 120,
      absTime: 40,
      transcode: false,
      duration: 600,
    });
    expect(f.displayTime).toBe(120);
    expect(f.pct).toBeCloseTo(20, 10);
  });

  it("paints live currentTime when no seek is in flight (direct path)", () => {
    const f = frameDisplay({
      pending: null,
      absTime: 40,
      transcode: false,
      duration: 600,
    });
    expect(f.displayTime).toBe(40);
  });

  it("ignores the pin on the transcode path (restart owns the timeline)", () => {
    const f = frameDisplay({
      pending: 120,
      absTime: 40,
      transcode: true,
      duration: 600,
    });
    expect(f.displayTime).toBe(40);
  });

  it("paints absTime on the transcode path with no pin", () => {
    const f = frameDisplay({
      pending: null,
      absTime: 321.5,
      transcode: true,
      duration: 8887.9,
    });
    expect(f.displayTime).toBe(321.5);
  });

  it("treats a 0 pin as a real pin (falsy but non-null)", () => {
    // Seeking back to the very start must hold at 0, not fall back to absTime.
    const f = frameDisplay({
      pending: 0,
      absTime: 40,
      transcode: false,
      duration: 600,
    });
    expect(f.displayTime).toBe(0);
    expect(f.pct).toBe(0);
  });

  it("ignores a stale pin once a transcode session starts", () => {
    // Pin set by a direct seek, then the source flips to transcode: the old
    // pin must not yank the thumb.
    const before = frameDisplay({
      pending: 500,
      absTime: 12,
      transcode: false,
      duration: 600,
    });
    const after = frameDisplay({
      pending: 500,
      absTime: 12,
      transcode: true,
      duration: 600,
    });
    expect(before.displayTime).toBe(500);
    expect(after.displayTime).toBe(12);
  });

  it("clamps progress to 100% when the pin overshoots duration", () => {
    const f = frameDisplay({
      pending: 700,
      absTime: 40,
      transcode: false,
      duration: 600,
    });
    expect(f.pct).toBe(100);
  });

  it("floors progress at 0% for a negative absTime", () => {
    const f = frameDisplay({
      pending: null,
      absTime: -3,
      transcode: false,
      duration: 600,
    });
    expect(f.pct).toBe(0);
  });

  it("reports 0% while duration is NaN (never paints NaN widths)", () => {
    const f = frameDisplay({
      pending: null,
      absTime: 40,
      transcode: false,
      duration: NaN,
    });
    expect(f.pct).toBe(0);
  });

  it("reports 0% while duration is Infinity", () => {
    const f = frameDisplay({
      pending: null,
      absTime: 40,
      transcode: false,
      duration: Infinity,
    });
    expect(f.pct).toBe(0);
  });

  it("reports 0% while duration is 0 (early metadata, not a 0-length title)", () => {
    const f = frameDisplay({
      pending: 10,
      absTime: 0,
      transcode: false,
      duration: 0,
    });
    // Selection is duration-independent; only the percentage is gated.
    expect(f.displayTime).toBe(10);
    expect(f.pct).toBe(0);
  });

  it("never surfaces NaN progress for a NaN pin (guards the fill width)", () => {
    const f = frameDisplay({
      pending: NaN,
      absTime: 40,
      transcode: false,
      duration: 600,
    });
    expect(f.pct).toBe(0);
  });

  it("selection and gating agree with isSeekableDuration", () => {
    // When the duration is not seekable the loop must not paint progress,
    // even though display selection itself stays total.
    for (const d of [NaN, Infinity, 0, -5]) {
      expect(isSeekableDuration(d)).toBe(false);
      expect(
        frameDisplay({ pending: null, absTime: 10, transcode: false, duration: d })
          .pct,
      ).toBe(0);
    }
    expect(isSeekableDuration(600)).toBe(true);
    expect(
      frameDisplay({ pending: null, absTime: 10, transcode: false, duration: 600 })
        .pct,
    ).toBeGreaterThan(0);
  });
});
