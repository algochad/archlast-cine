import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampSeekTarget } from "../../lib/seek";

/**
 * Pin lifecycle state-machine for `pendingSeekRef` in watch-player.tsx:
 *
 *   set(target)  -> pin armed (thumb holds at target)
 *   seeked event -> 1500ms grace (covers hls.js buffer-append settling where
 *                   currentTime can momentarily read the pre-seek value)
 *                -> clear (rAF resumes painting currentTime)
 *   supersede    -> a newer set() cancels the older grace timer
 *   teardown     -> source switch/unmount clears pin + all timers
 *   stuck guard  -> no `seeked` within 8000ms clears the pin anyway so the
 *                   thumb can never freeze forever
 *
 * The model below mirrors those transitions with the same constants while the
 * pin *value* flows through the real `clampSeekTarget`, so clamping and
 * duration-gating stay locked to the shared helper, not a reimplementation.
 */
type PinTimer = number | NodeJS.Timeout;
const GRACE_MS = 1500;
const STUCK_MS = 8000;

function createPinModel() {
  let pending: number | null = null;
  let grace: PinTimer | null = null;
  let stuck: PinTimer | null = null;
  const clearGrace = () => {
    if (grace !== null) {
      clearTimeout(grace);
      grace = null;
    }
  };
  const clearStuck = () => {
    if (stuck !== null) {
      clearTimeout(stuck);
      stuck = null;
    }
  };
  return {
    get pending(): number | null {
      return pending;
    },
    set(target: number, duration: number | null | undefined) {
      clearGrace();
      clearStuck();
      pending = clampSeekTarget(target, duration);
      if (pending !== null) {
        stuck = setTimeout(() => {
          pending = null;
          stuck = null;
          grace = null;
        }, STUCK_MS);
      }
    },
    onSeeked() {
      clearGrace();
      grace = setTimeout(() => {
        pending = null;
        grace = null;
        clearStuck();
      }, GRACE_MS);
    },
    teardown() {
      clearGrace();
      clearStuck();
      pending = null;
    },
  };
}

describe("seek pin lifecycle (pendingSeekRef state machine)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("follows set -> seeked -> grace -> clear", () => {
    const pin = createPinModel();
    pin.set(120, 600);
    expect(pin.pending).toBe(120);
    pin.onSeeked();
    expect(pin.pending).toBe(120); // grace: still pinned
    vi.advanceTimersByTime(1500);
    expect(pin.pending).toBeNull();
  });

  it("stays pinned just before the grace expires", () => {
    const pin = createPinModel();
    pin.set(120, 600);
    pin.onSeeked();
    vi.advanceTimersByTime(1499);
    expect(pin.pending).toBe(120);
    vi.advanceTimersByTime(1);
    expect(pin.pending).toBeNull();
  });

  it("a superseding seek cancels the prior grace timer", () => {
    const pin = createPinModel();
    pin.set(100, 600);
    pin.onSeeked();
    vi.advanceTimersByTime(1000);
    pin.set(200, 600); // newer seek supersedes: old clear must not fire
    vi.advanceTimersByTime(600); // past the first grace deadline
    expect(pin.pending).toBe(200);
    pin.onSeeked();
    vi.advanceTimersByTime(1500);
    expect(pin.pending).toBeNull();
  });

  it("rapid seeks keep only the latest pin", () => {
    const pin = createPinModel();
    pin.set(10, 600);
    pin.set(20, 600);
    pin.set(30, 600);
    expect(pin.pending).toBe(30);
    pin.onSeeked();
    vi.advanceTimersByTime(1500);
    expect(pin.pending).toBeNull();
  });

  it("teardown clears the pin and cancels pending timers", () => {
    const pin = createPinModel();
    pin.set(120, 600);
    pin.onSeeked();
    pin.teardown();
    expect(pin.pending).toBeNull();
    // Neither the grace nor the stuck fallback may resurrect anything.
    vi.advanceTimersByTime(30_000);
    expect(pin.pending).toBeNull();
  });

  it("teardown with no active pin is a harmless no-op", () => {
    const pin = createPinModel();
    expect(() => pin.teardown()).not.toThrow();
    expect(pin.pending).toBeNull();
  });

  it("stuck-pin fallback clears the pin after 8s without seeked", () => {
    const pin = createPinModel();
    pin.set(120, 600);
    vi.advanceTimersByTime(7999);
    expect(pin.pending).toBe(120);
    vi.advanceTimersByTime(1);
    expect(pin.pending).toBeNull();
  });

  it("a late seeked after the stuck fallback leaves the pin cleared", () => {
    const pin = createPinModel();
    pin.set(120, 600);
    vi.advanceTimersByTime(8000);
    expect(pin.pending).toBeNull();
    pin.onSeeked();
    vi.advanceTimersByTime(1500);
    expect(pin.pending).toBeNull();
  });

  it("seeked consumes the stuck fallback (no double-clear side effects)", () => {
    const pin = createPinModel();
    pin.set(120, 600);
    vi.advanceTimersByTime(5000);
    pin.onSeeked();
    vi.advanceTimersByTime(1500);
    expect(pin.pending).toBeNull();
    vi.advanceTimersByTime(10_000); // ex-stuck deadline passes silently
    expect(pin.pending).toBeNull();
  });

  it("a non-finite target never arms the pin", () => {
    const pin = createPinModel();
    for (const bad of [NaN, Infinity, -Infinity]) {
      pin.set(bad, 600);
      expect(pin.pending).toBeNull();
    }
    vi.advanceTimersByTime(30_000);
    expect(pin.pending).toBeNull();
  });

  it("an unseekable duration never arms the pin", () => {
    const pin = createPinModel();
    for (const d of [NaN, Infinity, 0, -10, null, undefined]) {
      pin.set(120, d);
      expect(pin.pending).toBeNull();
    }
  });

  it("clamps the pinned value into range via the shared helper", () => {
    const pin = createPinModel();
    pin.set(-25, 600);
    expect(pin.pending).toBe(0);
    pin.set(9999, 600);
    expect(pin.pending).toBe(600);
  });
});
