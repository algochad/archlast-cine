"use client";

/**
 * Smart speed / silence skip — P4.
 * Analyser RMS gate: silent >300ms while playing → silentRate (1.8×),
 * speech restores base rate. SSR-guarded, single analyser per element,
 * resume() on gesture, never stuck.
 */

export const SMART_SILENT_MS = 300;
export const SMART_SILENCE_THRESHOLD = 0.015;
export const DEFAULT_SILENT_RATE = 1.8;
export const SMART_POLL_MS = 100;

export interface SmartSpeedOptions {
  silentRate?: number;
  threshold?: number;
  silentMs?: number;
}

export interface SmartSpeedHandle {
  enable(): void;
  disable(): void;
  destroy(): void;
  resume(): Promise<void>;
  setSilentRate(rate: number): void;
  readonly enabled: boolean;
}

type Internal = {
  ctx: AudioContext;
  // Either a MediaElementSource or a MediaStreamSource (via captureStream)
  src: MediaElementAudioSourceNode | MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  data: Uint8Array;
  timer: number | null;
  enabled: boolean;
  silentRate: number;
  threshold: number;
  silentMs: number;
  silentSince: number | null;
  boosting: boolean;
  baseRate: number;
  video: HTMLVideoElement;
  destroyed: boolean;
};

const perElement = new WeakMap<HTMLVideoElement, Internal>();

function isSSR(): boolean {
  return typeof window === "undefined" || typeof document === "undefined";
}

function getAudioCtxCtor(): typeof AudioContext | null {
  if (isSSR()) return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function computeRms(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

function clampSilentRate(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SILENT_RATE;
  return Math.min(3, Math.max(1.1, n));
}

function tryCreateSource(
  ctx: AudioContext,
  video: HTMLVideoElement,
): MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null {
  // Prefer captureStream → MediaStreamSource to avoid colliding with an
  // existing MediaElementSource (volume boost). Fallback to MediaElementSource.
  try {
    const cap = (video as unknown as { captureStream?: () => MediaStream }).captureStream;
    if (typeof cap === "function") {
      const stream = cap.call(video) as MediaStream;
      if (stream && typeof stream.getAudioTracks === "function") {
        const tracks = stream.getAudioTracks();
        if (tracks.length === 0) {
          // No audio track yet — still create source; analyser will read silence until track appears.
        }
        const msSrc = ctx.createMediaStreamSource(stream);
        return msSrc;
      }
    }
  } catch {
    // fall through
  }
  try {
    const src = ctx.createMediaElementSource(video);
    return src;
  } catch {
    return null;
  }
}

export function createSmartSpeed(
  video: HTMLVideoElement,
  opts: SmartSpeedOptions = {},
): SmartSpeedHandle | null {
  if (isSSR() || !video) return null;
  const existing = perElement.get(video);
  if (existing && !existing.destroyed) {
    if (opts.silentRate != null) existing.silentRate = clampSilentRate(opts.silentRate);
    if (opts.threshold != null) existing.threshold = opts.threshold;
    if (opts.silentMs != null) existing.silentMs = opts.silentMs;
    return wrap(existing);
  }

  const Ctx = getAudioCtxCtor();
  if (!Ctx) return null;

  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }

  const src = tryCreateSource(ctx, video);
  if (!src) {
    try {
      ctx.close();
    } catch {}
    return null;
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.3;

  try {
    src.connect(analyser);
    // Keep analyser connected to destination so we still pull audio through.
    // For MediaStreamSource the graph is isolated; we still connect analyser
    // to destination to keep the node alive (and for MediaElementSource path).
    analyser.connect(ctx.destination);
  } catch {
    try {
      ctx.close();
    } catch {}
    return null;
  }

  const data = new Uint8Array(analyser.fftSize);
  const internal: Internal = {
    ctx,
    src,
    analyser,
    data,
    timer: null,
    enabled: false,
    silentRate: clampSilentRate(opts.silentRate ?? DEFAULT_SILENT_RATE),
    threshold: opts.threshold ?? SMART_SILENCE_THRESHOLD,
    silentMs: opts.silentMs ?? SMART_SILENT_MS,
    silentSince: null,
    boosting: false,
    baseRate: 1,
    video,
    destroyed: false,
  };

  const restoreBase = () => {
    if (!internal.boosting) return;
    internal.boosting = false;
    try {
      if (internal.video.playbackRate === internal.silentRate) {
        internal.video.playbackRate = internal.baseRate;
      }
    } catch {}
  };

  const tick = () => {
    if (internal.destroyed || !internal.enabled) return;
    if (video.paused || video.ended) {
      internal.silentSince = null;
      if (internal.boosting) restoreBase();
      return;
    }
    try {
      (internal.analyser.getByteTimeDomainData as (arr: Uint8Array) => void)(internal.data);
    } catch {
      return;
    }
    const rms = computeRms(internal.data);
    const isSilent = rms < internal.threshold;
    const now = performance.now();
    if (isSilent) {
      if (internal.silentSince == null) internal.silentSince = now;
      if (now - internal.silentSince >= internal.silentMs && !internal.boosting) {
        internal.baseRate = Number.isFinite(video.playbackRate) ? video.playbackRate : 1;
        // Avoid overriding a manual rate that already equals silentRate.
        try {
          video.playbackRate = internal.silentRate;
        } catch {}
        internal.boosting = true;
      }
    } else {
      internal.silentSince = null;
      if (internal.boosting) restoreBase();
    }
  };

  const startPoll = () => {
    if (internal.timer != null) return;
    internal.timer = window.setInterval(tick, SMART_POLL_MS);
  };
  const stopPoll = () => {
    if (internal.timer != null) {
      window.clearInterval(internal.timer);
      internal.timer = null;
    }
    internal.silentSince = null;
  };

  perElement.set(video, internal);

  const handle = makeHandle(internal, tick, restoreBase, startPoll, stopPoll);
  return handle;
}

function makeHandle(
  internal: Internal,
  tick: () => void,
  restoreBase: () => void,
  startPoll: () => void,
  stopPoll: () => void,
): SmartSpeedHandle {
  return {
    get enabled() {
      return internal.enabled;
    },
    enable() {
      if (internal.destroyed) return;
      if (internal.enabled) return;
      internal.enabled = true;
      internal.baseRate = Number.isFinite(internal.video.playbackRate)
        ? internal.video.playbackRate
        : 1;
      if (internal.ctx.state === "suspended") void internal.ctx.resume().catch(() => undefined);
      startPoll();
    },
    disable() {
      if (internal.destroyed) return;
      if (!internal.enabled) return;
      internal.enabled = false;
      stopPoll();
      if (internal.boosting) restoreBase();
    },
    destroy() {
      if (internal.destroyed) return;
      internal.destroyed = true;
      stopPoll();
      if (internal.boosting) restoreBase();
      try {
        internal.src.disconnect();
      } catch {}
      try {
        internal.analyser.disconnect();
      } catch {}
      try {
        internal.ctx.close();
      } catch {}
      perElement.delete(internal.video);
    },
    async resume() {
      if (internal.destroyed) return;
      if (internal.ctx.state === "suspended") {
        try {
          await internal.ctx.resume();
        } catch {}
      }
    },
    setSilentRate(rate: number) {
      internal.silentRate = clampSilentRate(rate);
      if (internal.boosting && internal.enabled) {
        try {
          internal.video.playbackRate = internal.silentRate;
        } catch {}
      }
    },
  };
}

function wrap(internal: Internal): SmartSpeedHandle {
  // Duplicate handle that proxies the same internal; ensures enable/disable
  // identity doesn't matter across call sites.
  return {
    get enabled() {
      return internal.enabled;
    },
    enable() {
      if (internal.destroyed) return;
      if (internal.enabled) return;
      internal.enabled = true;
      internal.baseRate = Number.isFinite(internal.video.playbackRate)
        ? internal.video.playbackRate
        : 1;
      if (internal.ctx.state === "suspended") void internal.ctx.resume().catch(() => undefined);
      if (internal.timer == null) internal.timer = window.setInterval(() => {
        if (internal.destroyed || !internal.enabled) return;
        if (internal.video.paused || internal.video.ended) {
          internal.silentSince = null;
          if (internal.boosting) {
            internal.boosting = false;
            try { if (internal.video.playbackRate === internal.silentRate) internal.video.playbackRate = internal.baseRate; } catch {}
          }
          return;
        }
        try { (internal.analyser.getByteTimeDomainData as (arr: Uint8Array) => void)(internal.data); } catch { return; }
        const rms = computeRms(internal.data);
        const isSilent = rms < internal.threshold;
        const now = performance.now();
        if (isSilent) {
          if (internal.silentSince == null) internal.silentSince = now;
          if (now - internal.silentSince >= internal.silentMs && !internal.boosting) {
            internal.baseRate = Number.isFinite(internal.video.playbackRate) ? internal.video.playbackRate : 1;
            try { internal.video.playbackRate = internal.silentRate; } catch {}
            internal.boosting = true;
          }
        } else {
          internal.silentSince = null;
          if (internal.boosting) {
            internal.boosting = false;
            try { if (internal.video.playbackRate === internal.silentRate) internal.video.playbackRate = internal.baseRate; } catch {}
          }
        }
      }, SMART_POLL_MS);
    },
    disable() {
      if (internal.destroyed) return;
      internal.enabled = false;
      if (internal.timer != null) {
        window.clearInterval(internal.timer);
        internal.timer = null;
      }
      internal.silentSince = null;
      if (internal.boosting) {
        internal.boosting = false;
        try {
          if (internal.video.playbackRate === internal.silentRate) internal.video.playbackRate = internal.baseRate;
        } catch {}
      }
    },
    destroy() {
      if (internal.destroyed) return;
      internal.destroyed = true;
      if (internal.timer != null) {
        window.clearInterval(internal.timer);
        internal.timer = null;
      }
      if (internal.boosting) {
        internal.boosting = false;
        try { if (internal.video.playbackRate === internal.silentRate) internal.video.playbackRate = internal.baseRate; } catch {}
      }
      try { internal.src.disconnect(); } catch {}
      try { internal.analyser.disconnect(); } catch {}
      try { internal.ctx.close(); } catch {}
      perElement.delete(internal.video);
    },
    async resume() {
      if (internal.destroyed) return;
      if (internal.ctx.state === "suspended") {
        try { await internal.ctx.resume(); } catch {}
      }
    },
    setSilentRate(rate: number) {
      internal.silentRate = clampSilentRate(rate);
      if (internal.boosting && internal.enabled) {
        try { internal.video.playbackRate = internal.silentRate; } catch {}
      }
    },
  };
}

export function resumeSmartSpeed(video: HTMLVideoElement): Promise<void> | null {
  if (isSSR()) return null;
  const inst = perElement.get(video);
  if (!inst) return null;
  if (inst.ctx.state === "suspended") return inst.ctx.resume().catch(() => undefined) as Promise<void>;
  return null;
}

export function getSmartSpeed(video: HTMLVideoElement): SmartSpeedHandle | null {
  if (isSSR()) return null;
  const inst = perElement.get(video);
  if (!inst || inst.destroyed) return null;
  return wrap(inst);
}

export function destroySmartSpeed(video: HTMLVideoElement): void {
  const inst = perElement.get(video);
  if (!inst) return;
  if (inst.timer != null) window.clearInterval(inst.timer);
  inst.destroyed = true;
  const wasBoosting = inst.boosting;
  const silentRate = inst.silentRate;
  const baseRate = inst.baseRate;
  inst.boosting = false;
  if (wasBoosting) {
    try { if (video.playbackRate === silentRate) video.playbackRate = baseRate; } catch {}
  }
  try { inst.src.disconnect(); } catch {}
  try { inst.analyser.disconnect(); } catch {}
  try { inst.ctx.close(); } catch {}
  perElement.delete(video);
}
