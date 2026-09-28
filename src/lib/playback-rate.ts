export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type PlaybackRate = (typeof SPEED_PRESETS)[number];

export function clampRate(r: unknown): number {
  const n = typeof r === 'number' ? r : typeof r === 'string' ? Number(r) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(0.25, n));
}

export function nearestPreset(r: number): number {
  let best: number = SPEED_PRESETS[0];
  let dist = Math.abs(r - best);
  for (const p of SPEED_PRESETS) {
    const d = Math.abs(r - p);
    if (d < dist) { dist = d; best = p; }
  }
  return best;
}

export function frameStep(current: number, dir: 1 | -1, fps = 30): number {
  const step = 1 / fps;
  return current + dir * step;
}
