import { describe, it, expect } from "vitest";
import { estimate, bufferTargetFor } from "../bandwidth";

describe("estimate", () => {
  it("returns 0 for empty array", () => {
    expect(estimate([])).toBe(0);
  });

  it("returns 0 for non-array input", () => {
    expect(estimate(null as unknown as { bytes: number; ms: number }[])).toBe(0);
    expect(estimate(undefined as unknown as { bytes: number; ms: number }[])).toBe(0);
  });

  it("computes bps for single sample", () => {
    // 1000 bytes in 1000ms => 8000 bps
    expect(estimate([{ bytes: 1000, ms: 1000 }])).toBe(8000);
  });

  it("computes bps for single large sample", () => {
    // 500_000 bytes in 1000ms => 4_000_000 bps
    expect(estimate([{ bytes: 500_000, ms: 1000 }])).toBe(4_000_000);
  });

  it("applies fast α0.3 slow α0.1 - conservative min", () => {
    // sample1: 1000 bytes 1000ms => 8000 bps
    // sample2: 2000 bytes 1000ms => 16000 bps
    // fast = 8000*0.7 + 16000*0.3 = 10400
    // slow = 8000*0.9 + 16000*0.1 = 8800
    // min = 8800
    expect(estimate([{ bytes: 1000, ms: 1000 }, { bytes: 2000, ms: 1000 }])).toBe(8800);
  });

  it("handles three samples EWMA progression", () => {
    // 1: 8000, 2: 16000, 3: 4000
    // after 1: fast=8000 slow=8000
    // after 2: fast=10400 slow=8800
    // after 3: fast=10400*0.7+4000*0.3=8480 slow=8800*0.9+4000*0.1=8320 min=8320
    expect(
      estimate([{ bytes: 1000, ms: 1000 }, { bytes: 2000, ms: 1000 }, { bytes: 500, ms: 1000 }])
    ).toBe(8320);
  });

  it("skips invalid samples", () => {
    expect(
      estimate([
        { bytes: 0, ms: 1000 },
        { bytes: 1000, ms: 0 },
        { bytes: NaN, ms: 1000 },
        { bytes: 1000, ms: Infinity },
        { bytes: 1000, ms: 1000 },
      ])
    ).toBe(8000);
  });

  it("skips negative bytes/ms", () => {
    expect(
      estimate([{ bytes: -100, ms: 1000 }, { bytes: 1000, ms: -500 }, { bytes: 1000, ms: 1000 }])
    ).toBe(8000);
  });

  it("returns 0 when all samples invalid", () => {
    expect(estimate([{ bytes: 0, ms: 0 }, { bytes: NaN, ms: NaN }])).toBe(0);
  });

  it("rounds result", () => {
    // 1 byte in 3ms => 2666.666...
    const r = estimate([{ bytes: 1, ms: 3 }]);
    expect(Number.isInteger(r)).toBe(true);
  });

  it("handles very high bandwidth", () => {
    // 10MB in 100ms => 800Mbps
    expect(estimate([{ bytes: 10_000_000, ms: 100 }])).toBe(800_000_000);
  });

  it("handles null/undefined fields gracefully", () => {
    expect(estimate([{ bytes: null as unknown as number, ms: 1000 }])).toBe(0);
    expect(estimate([{ bytes: 1000, ms: null as unknown as number }])).toBe(0);
  });
});

describe("bufferTargetFor", () => {
  it("returns 15s for <1Mbps", () => {
    expect(bufferTargetFor(500_000)).toBe(15);
    expect(bufferTargetFor(999_999)).toBe(15);
    expect(bufferTargetFor(0)).toBe(15);
  });

  it("returns 30s for <5Mbps", () => {
    expect(bufferTargetFor(1_000_000)).toBe(30);
    expect(bufferTargetFor(2_500_000)).toBe(30);
    expect(bufferTargetFor(4_999_999)).toBe(30);
  });

  it("returns 60s for >=5Mbps", () => {
    expect(bufferTargetFor(5_000_000)).toBe(60);
    expect(bufferTargetFor(10_000_000)).toBe(60);
    expect(bufferTargetFor(100_000_000)).toBe(60);
  });

  it("caps at 120s (never exceeds)", () => {
    expect(bufferTargetFor(1_000_000_000)).toBeLessThanOrEqual(120);
    expect(bufferTargetFor(Infinity)).toBe(60);
  });

  it("returns 15s for invalid/negative/NaN", () => {
    expect(bufferTargetFor(NaN)).toBe(15);
    expect(bufferTargetFor(Infinity * -1)).toBe(15);
    expect(bufferTargetFor(-100)).toBe(15);
    expect(bufferTargetFor(null as unknown as number)).toBe(15);
    expect(bufferTargetFor(undefined as unknown as number)).toBe(15);
  });

  it("handles boundary transitions without oscillation helper", () => {
    expect(bufferTargetFor(999_999)).toBe(15);
    expect(bufferTargetFor(1_000_000)).toBe(30);
    expect(bufferTargetFor(4_999_999)).toBe(30);
    expect(bufferTargetFor(5_000_000)).toBe(60);
  });
});
