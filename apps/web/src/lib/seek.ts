/**
 * Seek helpers shared by the watch player.
 * Pure functions — safe for SSR and unit tests.
 */

/** True only for a finite duration greater than zero. */
export function isSeekableDuration(d: number | null | undefined): boolean {
  return typeof d === "number" && Number.isFinite(d) && d > 0;
}

/**
 * Clamp a seek target into [0, duration].
 * Returns null when the seek cannot be performed: a non-finite target, or a
 * duration that is not finite and greater than zero.
 */
export function clampSeekTarget(target: number, duration: number | null | undefined): number | null {
  if (!Number.isFinite(target)) return null;
  if (!isSeekableDuration(duration)) return null;
  const dur = duration as number;
  if (target <= 0) return 0;
  if (target >= dur) return dur;
  return target;
}

/**
 * Display time for the timeline: an in-flight direct seek pins the thumb at
 * its target until the browser lands; on the transcode path the pin never
 * applies (absolute time comes from the live-window mapping).
 */
export function resolveDisplayTime(pending: number | null, absTime: number, transcode: boolean): number {
  if (pending != null && !transcode) return pending;
  return absTime;
}

/** Progress percentage in [0, 100]; guards non-finite / non-positive duration. */
export function seekProgressPct(displayTime: number, duration: number): number {
  if (!Number.isFinite(displayTime) || !Number.isFinite(duration) || duration <= 0) return 0;
  const pct = (displayTime / duration) * 100;
  if (!Number.isFinite(pct)) return 0;
  if (pct <= 0) return 0;
  if (pct >= 100) return 100;
  return pct;
}

export const SEEK_STEPS = [5, 10, 15, 30, 60] as const;
export type SeekStep = (typeof SEEK_STEPS)[number];

export function resolveSeekStep(pref: unknown): SeekStep {
  if (typeof pref === 'number' && (SEEK_STEPS as readonly number[]).includes(pref)) return pref as SeekStep;
  if (typeof pref === 'string') {
    const n = Number(pref);
    if ((SEEK_STEPS as readonly number[]).includes(n)) return n as SeekStep;
  }
  return 10;
}
export function chapterLeftPct(start: number, duration: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return 0;
  const pct = (start / duration) * 100;
  if (!Number.isFinite(pct)) return 0;
  if (pct <= 0) return 0;
  if (pct >= 100) return 100;
  return pct;
}

export function chapterWidthPct(start: number, end: number, duration: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(duration) || duration <= 0) return 0;
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0) return 0;
  const pct = (span / duration) * 100;
  if (!Number.isFinite(pct)) return 0;
  if (pct <= 0) return 0;
  if (pct >= 100) return 100;
  return pct;
}
/**
 * Fine-scrub sensitivity scaler.
 * During a drag, vertical offset dampens horizontal sensitivity:
 *   |dy| <= 40px  → 1× (normal)
 *   40 < |dy| <= 100 → 0.5× (fine)
 *   |dy| > 100 → 0.1× (ultra)
 * Converts a horizontal pixel delta into a time delta (seconds) using
 * pxPerSec (pixels per second, i.e. trackWidth / duration).
 * Pure — no DOM, no refs.
 */
export function applyScrubSensitivity(
  dxPx: number,
  pxPerSec: number,
  dyPx: number,
): { previewTime: number; mode: 'normal' | 'fine' | 'ultra' } {
  const dy = Number.isFinite(dyPx) ? Math.abs(dyPx) : 0;
  let mode: 'normal' | 'fine' | 'ultra' = 'normal';
  let factor = 1;
  if (dy > 100) {
    mode = 'ultra';
    factor = 0.1;
  } else if (dy > 40) {
    mode = 'fine';
    factor = 0.5;
  }
  let previewTime = 0;
  if (Number.isFinite(dxPx) && Number.isFinite(pxPerSec) && pxPerSec !== 0) {
    const delta = dxPx / pxPerSec;
    if (Number.isFinite(delta)) previewTime = delta * factor;
  }
  if (!Number.isFinite(previewTime)) previewTime = 0;
  return { previewTime, mode };
}
