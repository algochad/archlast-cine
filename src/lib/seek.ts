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
