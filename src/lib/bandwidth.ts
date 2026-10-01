export interface BandwidthSample {
  bytes: number;
  ms: number;
}

/**
 * EWMA bandwidth estimator.
 * Uses fast α=0.3 and slow α=0.1 over per-sample bps = bytes*8*1000/ms.
 * Returns conservative estimate = min(fastEWMA, slowEWMA) to avoid
 * upswitch flicker on spikes. Returns 0 for empty / invalid input.
 * Pure - no side effects.
 */
export function estimate(samples: BandwidthSample[]): number {
  if (!Array.isArray(samples) || samples.length === 0) return 0;
  let fast: number | null = null;
  let slow: number | null = null;
  let valid = 0;
  for (const s of samples) {
    if (!s || typeof s.bytes !== "number" || typeof s.ms !== "number") continue;
    const bytes = s.bytes;
    const ms = s.ms;
    if (!Number.isFinite(bytes) || !Number.isFinite(ms)) continue;
    if (bytes <= 0 || ms <= 0) continue;
    // bps = bytes * 8 bits / (ms/1000)  => bytes*8000/ms
    const bps = (bytes * 8000) / ms;
    if (!Number.isFinite(bps) || bps <= 0) continue;
    if (fast == null || slow == null) {
      fast = bps;
      slow = bps;
    } else {
      fast = fast * 0.7 + bps * 0.3;
      slow = slow * 0.9 + bps * 0.1;
    }
    valid += 1;
  }
  if (fast == null || slow == null || valid === 0) return 0;
  const est = Math.min(fast, slow);
  if (!Number.isFinite(est) || est <= 0) return 0;
  return Math.round(est);
}

/**
 * Dynamic forward-buffer target seconds for a given throughput.
 * <1 Mbps → 30s (constrained 3G)
 * <5 Mbps → 60s (average)
 * else     → 120s (fiber / high speed)
 * The transcode path produces ~16x realtime on this box, so a deep target
 * is cheap: the client banks minutes ahead instead of hovering at 2-10s.
 */
export function bufferTargetFor(bps: number): number {
  if (bps === Infinity) return 120;
  if (!Number.isFinite(bps) || bps <= 0) return 30;
  if (bps < 1_000_000) return 30;
  if (bps < 5_000_000) return 60;
  const base = 120;
  return Math.min(base, 180);
}
