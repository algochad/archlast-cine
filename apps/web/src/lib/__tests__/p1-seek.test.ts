import { describe, it, expect } from "vitest";
import { formatRemaining } from "../format";
import { isComplete } from "../history";
import { chapterLeftPct, chapterWidthPct } from "../seek";

describe("formatRemaining", () => {
  it("renders -remaining as clock with leading dash", () => {
    expect(formatRemaining(0, 100)).toBe("-1:40");
    expect(formatRemaining(30, 100)).toBe("-1:10");
    expect(formatRemaining(99, 100)).toBe("-0:01");
  });
  it("clamps display negative to zero (remaining = duration)", () => {
    expect(formatRemaining(-10, 60)).toBe("-1:00");
  });
  it("clamps display beyond duration to zero remaining", () => {
    expect(formatRemaining(200, 100)).toBe("-0:00");
    expect(formatRemaining(100, 100)).toBe("-0:00");
  });
  it("returns -0:00 for non-finite or non-positive duration", () => {
    expect(formatRemaining(10, 0)).toBe("-0:00");
    expect(formatRemaining(10, -5)).toBe("-0:00");
    expect(formatRemaining(10, NaN)).toBe("-0:00");
    expect(formatRemaining(10, Infinity)).toBe("-0:00");
  });
  it("returns -0:00 for non-finite display", () => {
    expect(formatRemaining(NaN, 100)).toBe("-0:00");
    expect(formatRemaining(Infinity, 100)).toBe("-0:00");
  });
  it("floors fractional seconds via formatClock", () => {
    expect(formatRemaining(59.9, 100)).toBe("-0:40");
    expect(formatRemaining(0, 3661)).toBe("-1:01:01");
  });
  it("handles zero display with hour duration", () => {
    expect(formatRemaining(0, 3600)).toBe("-1:00:00");
  });
});

describe("isComplete", () => {
  it("returns true past 98 percent", () => {
    expect(isComplete(99, 100)).toBe(true);
    expect(isComplete(98.01, 100)).toBe(true);
    expect(isComplete(200, 200)).toBe(true); // 1.0 > 0.98
  });
  it("returns false at exactly 98 percent", () => {
    expect(isComplete(98, 100)).toBe(false);
  });
  it("returns false below 98 percent", () => {
    expect(isComplete(50, 100)).toBe(false);
    expect(isComplete(0, 100)).toBe(false);
  });
  it("returns false for unknown or zero duration", () => {
    expect(isComplete(5000, 0)).toBe(false);
    expect(isComplete(10, -1)).toBe(false);
  });
  it("returns false for NaN or Infinity inputs", () => {
    expect(isComplete(NaN, 100)).toBe(false);
    expect(isComplete(50, NaN)).toBe(false);
    expect(isComplete(Infinity, Infinity)).toBe(false);
  });
  it("handles fractional boundaries", () => {
    expect(isComplete(0.99, 1)).toBe(true);
    expect(isComplete(0.98, 1)).toBe(false);
  });
});

describe("chapterLeftPct", () => {
  it("computes left as start/duration*100", () => {
    expect(chapterLeftPct(0, 100)).toBe(0);
    expect(chapterLeftPct(10, 100)).toBe(10);
    expect(chapterLeftPct(50, 200)).toBe(25);
  });
  it("clamps to 0..100", () => {
    expect(chapterLeftPct(-5, 100)).toBe(0);
    expect(chapterLeftPct(150, 100)).toBe(100);
  });
  it("returns 0 for non-finite or non-positive duration", () => {
    expect(chapterLeftPct(10, 0)).toBe(0);
    expect(chapterLeftPct(10, NaN)).toBe(0);
    expect(chapterLeftPct(NaN, 100)).toBe(0);
    expect(chapterLeftPct(Infinity, 100)).toBe(0);
  });
  it("handles fractional positions", () => {
    expect(chapterLeftPct(33.33, 100)).toBeCloseTo(33.33, 1);
  });
});

describe("chapterWidthPct", () => {
  it("computes width as (end-start)/duration*100", () => {
    expect(chapterWidthPct(10, 20, 100)).toBe(10);
    expect(chapterWidthPct(0, 50, 200)).toBe(25);
  });
  it("returns 0 for zero or negative span", () => {
    expect(chapterWidthPct(20, 20, 100)).toBe(0);
    expect(chapterWidthPct(20, 10, 100)).toBe(0);
  });
  it("clamps to 0..100", () => {
    expect(chapterWidthPct(-10, 10, 100)).toBe(20); // span 20, but left clamps elsewhere; width still 20
    expect(chapterWidthPct(0, 200, 100)).toBe(100);
  });
  it("returns 0 for non-finite or non-positive duration", () => {
    expect(chapterWidthPct(0, 10, 0)).toBe(0);
    expect(chapterWidthPct(0, 10, NaN)).toBe(0);
    expect(chapterWidthPct(NaN, 10, 100)).toBe(0);
    expect(chapterWidthPct(0, Infinity, 100)).toBe(0);
  });
  it("handles fractional spans", () => {
    expect(chapterWidthPct(0, 0.1, 1)).toBeCloseTo(10, 5);
  });
});
