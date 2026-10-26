import { describe, it, expect } from "vitest";
import { tapWindowMs, jumpForTaps, holdFired, isVerticalSwipe, distance, pinchScale } from "../gestures";

describe("tapWindowMs", () => {
  it("is 300ms per spec", () => {
    expect(tapWindowMs).toBe(300);
  });
  it("is a finite positive integer", () => {
    expect(Number.isFinite(tapWindowMs)).toBe(true);
    expect(tapWindowMs).toBeGreaterThan(0);
  });
});

describe("jumpForTaps", () => {
  it("returns baseStep for 1 tap", () => {
    expect(jumpForTaps(1, 10)).toBe(10);
  });
  it("returns baseStep for 2 taps (1×)", () => {
    expect(jumpForTaps(2, 10)).toBe(10);
    expect(jumpForTaps(2, 5)).toBe(5);
  });
  it("returns 2× baseStep for 3 taps", () => {
    expect(jumpForTaps(3, 10)).toBe(20);
    expect(jumpForTaps(3, 15)).toBe(30);
  });
  it("returns 3× baseStep for 4 taps", () => {
    expect(jumpForTaps(4, 10)).toBe(30);
    expect(jumpForTaps(4, 5)).toBe(15);
  });
  it("caps at 3× for 5+ taps", () => {
    expect(jumpForTaps(5, 10)).toBe(30);
    expect(jumpForTaps(10, 10)).toBe(30);
    expect(jumpForTaps(100, 10)).toBe(30);
  });
  it("floors fractional n", () => {
    expect(jumpForTaps(3.9, 10)).toBe(20); // floor 3 => 2×
    expect(jumpForTaps(4.7, 10)).toBe(30);
    expect(jumpForTaps(2.1, 10)).toBe(10);
  });
  it("handles 0 and negative as 1×", () => {
    expect(jumpForTaps(0, 10)).toBe(10);
    expect(jumpForTaps(-1, 10)).toBe(10);
  });
  it("returns baseStep for non-finite inputs", () => {
    expect(jumpForTaps(NaN, 10)).toBe(10);
    expect(jumpForTaps(Infinity, 10)).toBe(10);
    expect(jumpForTaps(2, NaN)).toBe(NaN); // baseStep non-finite returns baseStep (NaN)
  });
  it("works with different baseSteps 5/15/30/60", () => {
    expect(jumpForTaps(3, 5)).toBe(10);
    expect(jumpForTaps(3, 15)).toBe(30);
    expect(jumpForTaps(4, 30)).toBe(90);
    expect(jumpForTaps(4, 60)).toBe(180);
  });
});

describe("holdFired", () => {
  it("fires when >450ms and <10px", () => {
    expect(holdFired(451, 0)).toBe(true);
    expect(holdFired(500, 9.9)).toBe(true);
    expect(holdFired(1000, 5)).toBe(true);
  });
  it("does not fire at exactly 450ms", () => {
    expect(holdFired(450, 0)).toBe(false);
  });
  it("does not fire when >=10px move", () => {
    expect(holdFired(500, 10)).toBe(false);
    expect(holdFired(600, 15)).toBe(false);
  });
  it("does not fire when <450ms", () => {
    expect(holdFired(449, 0)).toBe(false);
    expect(holdFired(0, 0)).toBe(false);
  });
  it("returns false for non-finite inputs", () => {
    expect(holdFired(NaN, 0)).toBe(false);
    expect(holdFired(500, NaN)).toBe(false);
    expect(holdFired(Infinity, 0)).toBe(false);
  });
  it("handles fractional ms and px", () => {
    expect(holdFired(450.1, 9.99)).toBe(true);
    expect(holdFired(450.001, 0)).toBe(true);
  });
});

describe("isVerticalSwipe", () => {
  it("detects vertical swipe when |dy| > 2*|dx| and >24px", () => {
    expect(isVerticalSwipe(0, 30)).toBe(true);
    expect(isVerticalSwipe(5, 30)).toBe(true); // 30 >10 true
    expect(isVerticalSwipe(10, 30)).toBe(true); // 30 >20 true
  });
  it("rejects when not predominantly vertical (|dy| <=2*|dx|)", () => {
    expect(isVerticalSwipe(20, 30)).toBe(false); // 30 <=40 false
    expect(isVerticalSwipe(30, 30)).toBe(false);
    expect(isVerticalSwipe(0, 24)).toBe(false); // need >24
  });
  it("rejects when |dy| <=24", () => {
    expect(isVerticalSwipe(0, 24)).toBe(false);
    expect(isVerticalSwipe(0, 10)).toBe(false);
    expect(isVerticalSwipe(5, 20)).toBe(false);
  });
  it("handles negative dy (up swipe)", () => {
    expect(isVerticalSwipe(0, -30)).toBe(true);
    expect(isVerticalSwipe(5, -30)).toBe(true);
  });
  it("handles dx negative", () => {
    expect(isVerticalSwipe(-5, 30)).toBe(true);
    expect(isVerticalSwipe(-20, 30)).toBe(false);
  });
  it("returns false for non-finite inputs", () => {
    expect(isVerticalSwipe(NaN, 30)).toBe(false);
    expect(isVerticalSwipe(0, NaN)).toBe(false);
    expect(isVerticalSwipe(Infinity, 30)).toBe(false);
  });
  it("threshold boundary 24 vs 25", () => {
    expect(isVerticalSwipe(0, 24.1)).toBe(true);
    expect(isVerticalSwipe(0, 25)).toBe(true);
    expect(isVerticalSwipe(12, 24)).toBe(false); // 24 not >24, need >24
    expect(isVerticalSwipe(12, 24.1)).toBe(true); // 24.1 > 24
    expect(isVerticalSwipe(12, 25)).toBe(true); // 25 >24 true
  });
});

describe("distance", () => {
  it("computes Euclidean distance", () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(distance(0, 0, 0, 0)).toBe(0);
  });
  it("handles negative coordinates", () => {
    expect(distance(-1, -1, 2, 3)).toBe(5);
  });
  it("is symmetric", () => {
    expect(distance(1, 2, 3, 4)).toBe(distance(3, 4, 1, 2));
  });
});

describe("pinchScale", () => {
  it("returns current/initial", () => {
    expect(pinchScale(100, 150)).toBe(1.5);
    expect(pinchScale(100, 50)).toBe(0.5);
    expect(pinchScale(200, 200)).toBe(1);
  });
  it("returns 1 for non-finite or invalid initial", () => {
    expect(pinchScale(0, 100)).toBe(1);
    expect(pinchScale(NaN, 100)).toBe(1);
    expect(pinchScale(Infinity, 100)).toBe(1);
    expect(pinchScale(-10, 100)).toBe(1);
  });
  it("returns 1 for non-finite current", () => {
    expect(pinchScale(100, NaN)).toBe(1);
    expect(pinchScale(100, Infinity)).toBe(1);
  });
  it("handles fractional scales", () => {
    expect(pinchScale(100, 115)).toBeCloseTo(1.15);
    expect(pinchScale(100, 90)).toBeCloseTo(0.9);
  });
});
