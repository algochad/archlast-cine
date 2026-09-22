import { describe, it, expect } from "vitest";
import {
  clampSeekTarget,
  resolveDisplayTime,
  seekProgressPct,
  isSeekableDuration,
} from "../seek";

describe("clampSeekTarget", () => {
  it("passes through a mid-range target", () =>
    expect(clampSeekTarget(30, 100)).toBe(30));
  it("clamps a negative target to zero", () =>
    expect(clampSeekTarget(-5, 100)).toBe(0));
  it("clamps an over-duration target to duration", () =>
    expect(clampSeekTarget(150, 100)).toBe(100));
  it("accepts exact boundaries", () => {
    expect(clampSeekTarget(0, 100)).toBe(0);
    expect(clampSeekTarget(100, 100)).toBe(100);
  });
  it("returns null when duration is null", () =>
    expect(clampSeekTarget(10, null)).toBeNull());
  it("returns null when duration is undefined", () =>
    expect(clampSeekTarget(10, undefined)).toBeNull());
  it("returns null when duration is zero or negative", () => {
    expect(clampSeekTarget(0, 0)).toBeNull();
    expect(clampSeekTarget(10, -3)).toBeNull();
  });
  it("returns null when duration is NaN or Infinite", () => {
    expect(clampSeekTarget(10, NaN)).toBeNull();
    expect(clampSeekTarget(10, Infinity)).toBeNull();
  });
  it("returns null when target is NaN or Infinite", () => {
    expect(clampSeekTarget(NaN, 100)).toBeNull();
    expect(clampSeekTarget(Infinity, 100)).toBeNull();
    expect(clampSeekTarget(-Infinity, 100)).toBeNull();
  });
  it("keeps fractional precision (no floor loss)", () =>
    expect(clampSeekTarget(12.345, 100)).toBeCloseTo(12.345));
});

describe("resolveDisplayTime", () => {
  it("uses the pending seek while a seek is in flight", () =>
    expect(resolveDisplayTime(42, 10, false)).toBe(42));
  it("uses absolute time when nothing is pending", () =>
    expect(resolveDisplayTime(null, 10, false)).toBe(10));
  it("ignores pending while transcoding (remote clock owns the display)", () =>
    expect(resolveDisplayTime(42, 10, true)).toBe(10));
  it("uses absolute time when transcoding with nothing pending", () =>
    expect(resolveDisplayTime(null, 10, true)).toBe(10));
  it("treats a pending zero as a real seek, not as absent", () =>
    expect(resolveDisplayTime(0, 10, false)).toBe(0));
  it("passes fractional pending values through untouched", () =>
    expect(resolveDisplayTime(7.25, 3, false)).toBe(7.25));
});

describe("seekProgressPct", () => {
  it("computes a mid-range percentage", () =>
    expect(seekProgressPct(30, 100)).toBeCloseTo(30));
  it("returns 0 at the start", () => expect(seekProgressPct(0, 100)).toBe(0));
  it("returns 100 at the end", () => expect(seekProgressPct(100, 100)).toBe(100));
  it("clamps over-duration values to 100", () =>
    expect(seekProgressPct(150, 100)).toBe(100));
  it("clamps negative values to 0", () =>
    expect(seekProgressPct(-5, 100)).toBe(0));
  it("returns 0 when duration is zero or negative", () => {
    expect(seekProgressPct(10, 0)).toBe(0);
    expect(seekProgressPct(10, -4)).toBe(0);
  });
  it("returns 0 for non-finite inputs", () => {
    expect(seekProgressPct(NaN, 100)).toBe(0);
    expect(seekProgressPct(10, NaN)).toBe(0);
    expect(seekProgressPct(10, Infinity)).toBe(0);
    expect(seekProgressPct(Infinity, 100)).toBe(0);
  });
});

describe("isSeekableDuration", () => {
  it("accepts a normal finite duration", () => expect(isSeekableDuration(100)).toBe(true));
  it("accepts fractional durations", () => expect(isSeekableDuration(0.5)).toBe(true));
  it("rejects zero", () => expect(isSeekableDuration(0)).toBe(false));
  it("rejects negatives", () => expect(isSeekableDuration(-10)).toBe(false));
  it("rejects NaN", () => expect(isSeekableDuration(NaN)).toBe(false));
  it("rejects Infinity", () => {
    expect(isSeekableDuration(Infinity)).toBe(false);
    expect(isSeekableDuration(-Infinity)).toBe(false);
  });
  it("rejects null and undefined (live/unknown duration)", () => {
    expect(isSeekableDuration(null)).toBe(false);
    expect(isSeekableDuration(undefined)).toBe(false);
  });
});

describe("first-skip duration gating (prod narrowing)", () => {
  it("defers a first skip while duration is NaN instead of jumping to 0", () => {
    const gated = clampSeekTarget(45, NaN);
    expect(gated).toBeNull();
    expect(gated).not.toBe(0);
  });
  it("defers a first skip while duration is Infinity instead of jumping to 0", () => {
    const gated = clampSeekTarget(45, Infinity);
    expect(gated).toBeNull();
    expect(gated).not.toBe(0);
  });
  it("defers a first skip while duration is still 0 instead of jumping to start", () => {
    const gated = clampSeekTarget(45, 0);
    expect(gated).toBeNull();
    expect(gated).not.toBe(0);
  });
  it("defers a first skip while duration is unknown (null/undefined/negative)", () => {
    for (const d of [null, undefined, -1, -Infinity] as const) {
      const gated = clampSeekTarget(45, d);
      expect(gated).toBeNull();
      expect(gated).not.toBe(0);
    }
  });
  it("defers even a tiny target pre-metadata (no clamp-to-0 shortcut)", () => {
    expect(clampSeekTarget(0.001, NaN)).toBeNull();
    expect(clampSeekTarget(0, NaN)).toBeNull();
    expect(clampSeekTarget(0, 0)).toBeNull();
  });
  it("defers an oversize target pre-metadata instead of clamping to a bogus bound", () => {
    expect(clampSeekTarget(1e9, NaN)).toBeNull();
    expect(clampSeekTarget(1e9, 0)).toBeNull();
    expect(clampSeekTarget(1e9, Infinity)).toBeNull();
  });
  it("lands the same target post-metadata after deferring pre-metadata", () => {
    const target = 45;
    expect(clampSeekTarget(target, NaN)).toBeNull();
    expect(clampSeekTarget(target, 0)).toBeNull();
    expect(clampSeekTarget(target, 100)).toBe(target);
  });
  it("lands the same fractional target post-metadata with no precision loss", () => {
    const target = 12.345;
    expect(clampSeekTarget(target, Infinity)).toBeNull();
    expect(clampSeekTarget(target, 100)).toBeCloseTo(target);
  });
  it("gates isSeekableDuration false pre-metadata, true post-metadata", () => {
    for (const d of [NaN, Infinity, -Infinity, 0, -5, null, undefined] as const) {
      expect(isSeekableDuration(d)).toBe(false);
    }
    expect(isSeekableDuration(100)).toBe(true);
  });
  it("treats negative zero as unseekable (no seek to start)", () => {
    expect(isSeekableDuration(-0)).toBe(false);
    expect(clampSeekTarget(10, -0)).toBeNull();
  });
  it("accepts epsilon and sub-second durations as seekable once known", () => {
    expect(isSeekableDuration(Number.EPSILON)).toBe(true);
    expect(isSeekableDuration(Number.MIN_VALUE)).toBe(true);
    expect(isSeekableDuration(0.001)).toBe(true);
    expect(clampSeekTarget(0.0005, 0.001)).toBeCloseTo(0.0005);
  });
  it("accepts very large finite durations as seekable", () => {
    expect(isSeekableDuration(Number.MAX_VALUE)).toBe(true);
    expect(isSeekableDuration(1e12)).toBe(true);
    expect(clampSeekTarget(1e12, 1e12)).toBe(1e12);
  });
  it("still clamps the landed retry to duration bounds post-metadata", () => {
    expect(clampSeekTarget(-3, 100)).toBe(0);
    expect(clampSeekTarget(100.25, 100)).toBe(100);
    expect(clampSeekTarget(99.999, 100)).toBeCloseTo(99.999);
  });
});
