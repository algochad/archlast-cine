/**
 * Stats samplers for "Stats for Nerds" overlay.
 * Poll via sampleStats(video, hls?, dash?) every 1s.
 * FPS uses requestVideoFrameCallback delta when available.
 */

export interface StatsSnapshot {
  fps: number | null;
  bitrate: number | null;
  codec: string | null;
  buffered: number;
  dropped: number;
  resolution: string;
}

const fpsState = new WeakMap<HTMLVideoElement, { last: number; fps: number | null }>();

function trackFps(video: HTMLVideoElement): number | null {
  const state = fpsState.get(video);
  if (state) return state.fps;
  const init = { last: performance.now(), fps: null as number | null };
  fpsState.set(video, init);
  const rVFC = (video as unknown as { requestVideoFrameCallback?: (cb: (now: number, metadata: unknown) => void) => number }).requestVideoFrameCallback;
  if (typeof rVFC !== "function") return null;
  const cb = (_now: number, _metadata: unknown) => {
    const s = fpsState.get(video);
    if (!s) return;
    const now = performance.now();
    const delta = now - s.last;
    if (delta > 0 && delta < 2000) {
      const fps = 1000 / delta;
      if (Number.isFinite(fps)) s.fps = Math.round(fps * 10) / 10;
    }
    s.last = now;
    try {
      const rvfc2 = (video as unknown as { requestVideoFrameCallback: (cb: (now: number, metadata: unknown) => void) => number }).requestVideoFrameCallback;
      rvfc2.call(video, cb);
    } catch {
      /* no rVFC */
    }
  };
  try {
    rVFC.call(video, cb);
  } catch {
    /* ignore */
  }
  return null;
}

function getBufferedAhead(video: HTMLVideoElement): number {
  try {
    if (video.buffered.length === 0) return 0;
    const end = video.buffered.end(video.buffered.length - 1);
    const cur = video.currentTime;
    if (!Number.isFinite(end) || !Number.isFinite(cur)) return 0;
    const ahead = end - cur;
    return ahead > 0 && Number.isFinite(ahead) ? ahead : 0;
  } catch {
    return 0;
  }
}

function getDropped(video: HTMLVideoElement): number {
  try {
    const q = (video as unknown as { getVideoPlaybackQuality?: () => { droppedVideoFrames: number } }).getVideoPlaybackQuality?.();
    if (q && typeof q.droppedVideoFrames === "number") return q.droppedVideoFrames;
  } catch {}
  try {
    const wk = video as unknown as { webkitDroppedFrameCount?: number };
    if (typeof wk.webkitDroppedFrameCount === "number") return wk.webkitDroppedFrameCount;
  } catch {}
  return 0;
}

function getResolution(video: HTMLVideoElement): string {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w > 0 && h > 0) return `${w}×${h}`;
  return "—";
}

function getBitrate(hls: unknown, dash: unknown): number | null {
  try {
    const h = hls as { levels?: Array<{ bitrate: number }>; currentLevel?: number; loadLevel?: number } | null;
    if (h && Array.isArray(h.levels)) {
      const idx = typeof h.currentLevel === "number" && h.currentLevel >= 0 ? h.currentLevel : typeof h.loadLevel === "number" && h.loadLevel >= 0 ? h.loadLevel : -1;
      if (idx >= 0 && h.levels[idx] && Number.isFinite(h.levels[idx].bitrate)) return h.levels[idx].bitrate as number;
      for (const lvl of h.levels) if (lvl && Number.isFinite(lvl.bitrate)) return lvl.bitrate;
    }
  } catch {}
  try {
    const d = dash as { getAverageThroughput?: (t: string) => number } | null;
    if (d && typeof d.getAverageThroughput === "function") {
      const thr = d.getAverageThroughput("video");
      if (Number.isFinite(thr) && thr > 0) return Math.round(thr * 1000);
    }
  } catch {}
  return null;
}

function getCodec(hls: unknown, dash: unknown): string | null {
  try {
    const h = hls as { levels?: Array<{ videoCodec?: string; codecs?: string }> } | null;
    if (h && Array.isArray(h.levels)) {
      for (const lvl of h.levels) {
        if (lvl?.videoCodec) return lvl.videoCodec;
        if (lvl?.codecs) return lvl.codecs;
      }
    }
  } catch {}
  try {
    const d = dash as { getCurrentTrackFor?: (t: string) => { codec?: string } } | null;
    if (d && typeof d.getCurrentTrackFor === "function") {
      const tr = d.getCurrentTrackFor("video");
      if (tr?.codec) return tr.codec;
    }
  } catch {}
  return null;
}

export function sampleStats(
  video: HTMLVideoElement | null,
  hls?: unknown,
  dash?: unknown,
): StatsSnapshot {
  if (!video) {
    return { fps: null, bitrate: null, codec: null, buffered: 0, dropped: 0, resolution: "—" };
  }
  const hasRvfc = typeof (video as unknown as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === "function";
  const fps = hasRvfc ? (trackFps(video), fpsState.get(video)?.fps ?? null) : null;
  return {
    fps,
    bitrate: getBitrate(hls ?? null, dash ?? null),
    codec: getCodec(hls ?? null, dash ?? null),
    buffered: getBufferedAhead(video),
    dropped: getDropped(video),
    resolution: getResolution(video),
  };
}
