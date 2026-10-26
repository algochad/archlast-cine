/**
 * Pure gesture classifiers — no DOM, no React.
 * Covered by vitest; keep one describe per export.
 */

export const tapWindowMs = 300;

/**
 * Scale jump for consecutive taps.
 * 2 taps → 1× baseStep, 3 taps → 2×, 4+ taps → 3×.
 */
export function jumpForTaps(n: number, baseStep: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(baseStep)) return baseStep;
  const clamped = Math.floor(n);
  if (clamped >= 4) return baseStep * 3;
  if (clamped >= 3) return baseStep * 2;
  return baseStep;
}

/**
 * True when a press qualifies as a hold.
 * >450ms dwell with <10px drift.
 */
export function holdFired(downMs: number, movePx: number): boolean {
  if (!Number.isFinite(downMs) || !Number.isFinite(movePx)) return false;
  return downMs > 450 && movePx < 10;
}

/**
 * True for a predominantly vertical drag.
 * |dy| > 2*|dx| and |dy| > 24px. Horizontal swipes are ignored.
 */
export function isVerticalSwipe(dx: number, dy: number): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  return Math.abs(dy) > 2 * Math.abs(dx) && Math.abs(dy) > 24;
}

/** Alias for external callers that expect the spec phrasing. */
export const swipeIsVertical = isVerticalSwipe;

/** Distance between two points. */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

/** Pinch scale ratio; initial 0 degenerates to 1. */
export function pinchScale(initial: number, current: number): number {
  if (!Number.isFinite(initial) || !Number.isFinite(current) || initial <= 0) return 1;
  return current / initial;
}
