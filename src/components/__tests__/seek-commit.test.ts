import { describe, expect, it, vi } from "vitest";
import {
  clampSeekTarget,
  isSeekableDuration,
  resolveDisplayTime,
} from "../../lib/seek";

/**
 * Commit parsing mirrors `commitSeekFromRange` + the slider `onChange` guard
 * in watch-player.tsx:
 *
 *   const commitSeekFromRange = (target: HTMLInputElement) => {
 *     draggingRef.current = false;
 *     const value = Number(target.value);
 *     if (!Number.isFinite(value)) return;
 *     void seekAbsoluteRef.current(value);
 *   };
 *
 *   onChange: const max = Number(target.max || 0); ... if (max <= 0) return;
 *
 * Duration-gating (NaN/Inf/0 must block instead of jumping to 0) flows through
 * the shared helpers so the "no seek to 0 on unknown duration" contract holds.
 */
function parseCommit(
  rawValue: string,
  opts: { max: number; duration: number | null | undefined },
): number | null {
  // onChange guard: an unmeasured slider (max<=0) blocks keyboard seeks.
  if (!(opts.max > 0)) return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  if (!isSeekableDuration(opts.duration)) return null;
  return clampSeekTarget(value, opts.duration);
}

describe("commit parsing (slider value -> absolute seek target)", () => {
  const LIVE = { max: 600, duration: 600 };

  it("commits a plain in-range integer", () => {
    expect(parseCommit("120", LIVE)).toBe(120);
  });

  it("rejects non-numeric input", () => {
    expect(parseCommit("abc", LIVE)).toBeNull();
    expect(parseCommit("12px", LIVE)).toBeNull();
  });

  it("rejects NaN", () => {
    expect(parseCommit("NaN", LIVE)).toBeNull();
  });

  it("rejects Infinity / -Infinity", () => {
    expect(parseCommit("Infinity", LIVE)).toBeNull();
    expect(parseCommit("-Infinity", LIVE)).toBeNull();
  });

  it("clamps negatives to 0 instead of seeking out of range", () => {
    expect(parseCommit("-5", LIVE)).toBe(0);
  });

  it("clamps beyond-duration values to duration", () => {
    expect(parseCommit("9999", LIVE)).toBe(600);
  });

  it("preserves fractional values (no floor() precision loss on commit)", () => {
    // The slider displays Math.floor(displayTime) but the commit path must
    // carry the exact value through.
    expect(parseCommit("12.7", LIVE)).toBe(12.7);
  });

  it("accepts surrounding whitespace the way Number() does", () => {
    expect(parseCommit("  42  ", LIVE)).toBe(42);
  });

  it("blocks when max<=0 (keyboard seeks before metadata loads)", () => {
    expect(parseCommit("10", { max: 0, duration: 600 })).toBeNull();
    expect(parseCommit("10", { max: -1, duration: 600 })).toBeNull();
  });

  it("blocks when duration is NaN instead of jumping to 0", () => {
    expect(parseCommit("10", { max: 600, duration: NaN })).toBeNull();
  });

  it("blocks when duration is Infinity", () => {
    expect(parseCommit("10", { max: 600, duration: Infinity })).toBeNull();
  });

  it("blocks when duration is 0 or negative", () => {
    expect(parseCommit("10", { max: 600, duration: 0 })).toBeNull();
    expect(parseCommit("10", { max: 600, duration: -3 })).toBeNull();
  });

  it("blocks when duration is unknown (null/undefined)", () => {
    expect(parseCommit("10", { max: 600, duration: null })).toBeNull();
    expect(parseCommit("10", { max: 600, duration: undefined })).toBeNull();
  });
});

/**
 * Drag discipline mirrors the slider pointer handlers:
 *
 *   onPointerDown: draggingRef = true; pendingSeekRef = null (stale pin
 *                  cleared; the drag preview owns the thumb now)
 *   onChange:      preview paints time/fill; commits immediately ONLY for
 *                  keyboard-driven changes (!dragging)
 *   onPointerUp:   commitSeekFromRange (release commits once)
 *   onPointerCancel: dragging = false; pending = null (no commit; rAF
 *                  resumes from the live position)
 *   rAF loop:      `if (!draggingRef.current) { ...paint... }`
 */
function createDragModel(commit: (value: number) => void) {
  const paints: Array<{ kind: "time" | "fill"; value: number | string }> = [];
  let dragging = false;
  let preview: number | null = null;
  let pending: number | null = null;
  let released = false;
  return {
    paints,
    get dragging() {
      return dragging;
    },
    get pending() {
      return pending;
    },
    /** Test hook mirroring the in-flight seek pin a drag supersedes. */
    seedPending(value: number) {
      pending = value;
    },
    pointerDown() {
      dragging = true;
      released = false;
      pending = null;
      preview = null;
    },
    /** Mirrors onChange preview painting + keyboard immediate-commit. */
    onChange(rawValue: string, max: number) {
      const v = Number(rawValue);
      if (!Number.isFinite(v) || !(max > 0)) return;
      const pct = Math.min(100, Math.max(0, (v / max) * 100));
      paints.push({ kind: "time", value: v });
      paints.push({ kind: "fill", value: pct });
      preview = v;
      if (!dragging) commit(v);
    },
    /** Mirrors onPointerUp -> commitSeekFromRange (commits once). */
    pointerUp() {
      if (!dragging || released) return;
      released = true;
      dragging = false;
      if (preview !== null && Number.isFinite(preview)) commit(preview);
      preview = null;
    },
    pointerCancel() {
      dragging = false;
      released = false;
      pending = null;
      preview = null;
    },
    /** Mirrors the rAF guard: suppressed while dragging. */
    frameTick(absTime: number): number | "suppressed" {
      if (dragging) return "suppressed";
      return resolveDisplayTime(pending, absTime, false);
    },
  };
}

describe("drag discipline (preview owns the thumb, release commits once)", () => {
  it("suppresses rAF paints while dragging, even with a pin set", () => {
    const model = createDragModel(() => undefined);
    model.seedPending(999); // in-flight pin from a prior keyboard/media seek
    model.pointerDown(); // drag start clears the stale pin, owns the thumb
    expect(model.pending).toBeNull();
    expect(model.frameTick(40)).toBe("suppressed");
  });

  it("preview paints time + fill without committing while dragging", () => {
    const commit = vi.fn();
    const model = createDragModel(commit);
    model.pointerDown();
    model.onChange("120", 600);
    expect(commit).not.toHaveBeenCalled();
    expect(model.paints).toContainEqual({ kind: "time", value: 120 });
    expect(model.paints).toContainEqual({ kind: "fill", value: 20 });
  });

  it("release commits exactly once with the preview value", () => {
    const commit = vi.fn();
    const model = createDragModel(commit);
    model.pointerDown();
    model.onChange("100", 600);
    model.onChange("120", 600);
    model.pointerUp();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(120);
  });

  it("a second release without a new drag commits nothing", () => {
    const commit = vi.fn();
    const model = createDragModel(commit);
    model.pointerDown();
    model.onChange("120", 600);
    model.pointerUp();
    model.pointerUp();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("cancel commits nothing and clears the pin", () => {
    const commit = vi.fn();
    const model = createDragModel(commit);
    model.pointerDown();
    model.onChange("120", 600);
    model.pointerCancel();
    expect(commit).not.toHaveBeenCalled();
    expect(model.pending).toBeNull();
    expect(model.dragging).toBe(false);
  });

  it("rAF resumes from the live position after cancel", () => {
    const model = createDragModel(() => undefined);
    model.pointerDown();
    model.onChange("120", 600);
    model.pointerCancel();
    expect(model.frameTick(42)).toBe(42);
  });

  it("pointerDown clears a stale seek pin", () => {
    const model = createDragModel(() => undefined);
    model.seedPending(500);
    expect(model.pending).toBe(500);
    model.pointerDown();
    expect(model.pending).toBeNull();
  });

  it("keyboard-driven changes (no pointer grab) commit immediately", () => {
    const commit = vi.fn();
    const model = createDragModel(commit);
    model.onChange("130", 600); // dragging is false: keyboard path
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(130);
  });

  it("preview with max<=0 paints nothing and commits nothing", () => {
    const commit = vi.fn();
    const model = createDragModel(commit);
    model.pointerDown();
    model.onChange("10", 0);
    expect(commit).not.toHaveBeenCalled();
    expect(model.paints).toHaveLength(0);
  });
});

describe("first-skip commit deferral (unknown duration queues, retry lands)", () => {
  it("first commit with NaN duration queues instead of jumping to 0", () => {
    expect(parseCommit("120", { max: 600, duration: NaN })).toBeNull();
    // The queued raw value survives; the same spot lands once metadata arrives.
    expect(parseCommit("120", { max: 600, duration: 600 })).toBe(120);
  });

  it("first commit with Infinity duration queues, retry lands", () => {
    expect(parseCommit("120", { max: 600, duration: Infinity })).toBeNull();
    expect(parseCommit("120", { max: 600, duration: 600 })).toBe(120);
  });

  it("first commit with 0 duration queues, retry lands", () => {
    expect(parseCommit("45", { max: 600, duration: 0 })).toBeNull();
    expect(parseCommit("45", { max: 600, duration: 600 })).toBe(45);
  });

  it("queued first skip clamps when metadata reveals a shorter title", () => {
    expect(parseCommit("9999", { max: 600, duration: NaN })).toBeNull();
    expect(parseCommit("9999", { max: 600, duration: 600 })).toBe(600);
  });

  it("queued negative first skip still clamps to 0 post-metadata", () => {
    expect(parseCommit("-5", { max: 600, duration: NaN })).toBeNull();
    expect(parseCommit("-5", { max: 600, duration: 600 })).toBe(0);
  });

  it("non-numeric first input never queues (nothing to retry)", () => {
    expect(parseCommit("abc", { max: 600, duration: NaN })).toBeNull();
    expect(parseCommit("abc", { max: 600, duration: 600 })).toBeNull();
  });
});
