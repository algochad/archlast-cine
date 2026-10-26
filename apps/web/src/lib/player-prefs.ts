import { resolveSeekStep } from "@/lib/seek";
import { clampRate } from "@/lib/playback-rate";
import { DEFAULT_SUB_STYLE, coerceSubStyle, type SubStyle } from "@/lib/sub-style";

export type SeekStep = 5 | 10 | 15 | 30 | 60;
export type TimeMode = 'elapsed' | 'remaining';
export type AspectMode = 'contain' | 'cover' | 'fill';
export type FilterMode = 'none' | 'anime' | 'contrast';
export type SubFilter = 'all' | 'signs';
export type HoldBoostRate = 1.5 | 2 | 2.5 | 3;
export type BackBuffer = 15 | 30 | 60 | 0;

export interface PlayerPrefs {
  seekStep: SeekStep;
  timeMode: TimeMode;
  playbackRate: number;
  pitchLock: boolean;
  smartSpeed: boolean;
  holdBoostRate: HoldBoostRate;
  volume: number;
  muted: boolean;
  volumeBoost: boolean;
  normalize: boolean;
  brightness: number;
  aspectMode: AspectMode;
  filter: FilterMode;
  nightDim: number;
  autoplay: boolean;
  autoplayDelay: number;
  prefSubLang: string[];
  prefAudioLang: string[];
  prefForced: boolean;
  preferSDH: boolean;
  dualSubs: boolean;
  subOffsetMs: number;
  subOffsetMs2: number;
  subStyle: SubStyle;
  subFilter: SubFilter;
  backBuffer: BackBuffer;
  lastBps: number;
  parallelMp4: boolean;
  statsOpen: boolean;
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  seekStep: 10,
  timeMode: 'elapsed',
  playbackRate: 1,
  pitchLock: true,
  smartSpeed: false,
  holdBoostRate: 2,
  volume: 1,
  muted: false,
  volumeBoost: false,
  normalize: false,
  brightness: 1,
  aspectMode: 'contain',
  filter: 'none',
  nightDim: 0,
  autoplay: true,
  autoplayDelay: 10,
  prefSubLang: ['en'],
  prefAudioLang: ['ja', 'en'],
  prefForced: true,
  preferSDH: false,
  dualSubs: false,
  subOffsetMs: 0,
  subOffsetMs2: 0,
  subStyle: DEFAULT_SUB_STYLE,
  subFilter: 'all',
  backBuffer: 30,
  lastBps: 2_000_000,
  parallelMp4: false,
  statsOpen: false,
};

const KEY = "moviebox.prefs.v1";
const SEEDED_KEY = "moviebox.prefs.seeded";

export const PLAYER_PREFS_KEY = KEY;
export const PLAYER_PREFS_SEEDED_KEY = SEEDED_KEY;
export const PLAYER_PREFS_SEEDED_LEGACY_KEY = "prefsSeeded";

export type PlayerSyncSubset = Pick<
  PlayerPrefs,
  'seekStep' | 'playbackRate' | 'autoplay' | 'prefSubLang' | 'prefAudioLang' | 'subStyle' | 'aspectMode'
>;

export const SYNC_KEYS: (keyof PlayerSyncSubset)[] = [
  'seekStep',
  'playbackRate',
  'autoplay',
  'prefSubLang',
  'prefAudioLang',
  'subStyle',
  'aspectMode',
];

export function extractSyncSubset(prefs: PlayerPrefs): PlayerSyncSubset {
  return {
    seekStep: prefs.seekStep,
    playbackRate: prefs.playbackRate,
    autoplay: prefs.autoplay,
    prefSubLang: [...prefs.prefSubLang],
    prefAudioLang: [...prefs.prefAudioLang],
    subStyle: { ...prefs.subStyle },
    aspectMode: prefs.aspectMode,
  };
}

function coerceTimeMode(v: unknown, fallback: TimeMode): TimeMode {
  return v === 'elapsed' || v === 'remaining' ? v : fallback;
}
function coerceHoldBoostRate(v: unknown, fallback: HoldBoostRate): HoldBoostRate {
  if (v === 1.5 || v === 2 || v === 2.5 || v === 3) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (n === 1.5 || n === 2 || n === 2.5 || n === 3) return n as HoldBoostRate;
  }
  return fallback;
}
function coerceAspectMode(v: unknown, fallback: AspectMode): AspectMode {
  return v === 'contain' || v === 'cover' || v === 'fill' ? v : fallback;
}
function coerceFilterMode(v: unknown, fallback: FilterMode): FilterMode {
  return v === 'none' || v === 'anime' || v === 'contrast' ? v : fallback;
}
function coerceSubFilter(v: unknown, fallback: SubFilter): SubFilter {
  return v === 'all' || v === 'signs' ? v : fallback;
}
function coerceBackBuffer(v: unknown, fallback: BackBuffer): BackBuffer {
  if (v === 15 || v === 30 || v === 60 || v === 0) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (n === 15 || n === 30 || n === 60 || n === 0) return n as BackBuffer;
  }
  return fallback;
}
function coerceBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function coerceNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function coerceStringArray(v: unknown, fallback: string[]): string[] {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.map(String);
  if (Array.isArray(v)) {
    const filtered = v.filter((x) => typeof x === 'string' && x.length > 0).map(String);
    if (filtered.length > 0) return filtered;
  }
  return [...fallback];
}
function coercePrefs(raw: unknown): PlayerPrefs {
  const d = DEFAULT_PLAYER_PREFS;
  if (typeof raw !== 'object' || raw === null) return { ...d, subStyle: { ...d.subStyle }, prefSubLang: [...d.prefSubLang], prefAudioLang: [...d.prefAudioLang] };
  const v = raw as Record<string, unknown>;
  return {
    seekStep: resolveSeekStep(v.seekStep),
    timeMode: coerceTimeMode(v.timeMode, d.timeMode),
    playbackRate: clampRate(v.playbackRate),
    pitchLock: coerceBoolean(v.pitchLock, d.pitchLock),
    smartSpeed: coerceBoolean(v.smartSpeed, d.smartSpeed),
    holdBoostRate: coerceHoldBoostRate(v.holdBoostRate, d.holdBoostRate),
    volume: coerceNumber(v.volume, d.volume, 0, 1),
    muted: coerceBoolean(v.muted, d.muted),
    volumeBoost: coerceBoolean(v.volumeBoost, d.volumeBoost),
    normalize: coerceBoolean(v.normalize, d.normalize),
    brightness: coerceNumber(v.brightness, d.brightness, 0.3, 1),
    aspectMode: coerceAspectMode(v.aspectMode, d.aspectMode),
    filter: coerceFilterMode(v.filter, d.filter),
    nightDim: coerceNumber(v.nightDim, d.nightDim, 0, 1),
    autoplay: coerceBoolean(v.autoplay, d.autoplay),
    autoplayDelay: coerceNumber(v.autoplayDelay, d.autoplayDelay, 1, 120),
    prefSubLang: coerceStringArray(v.prefSubLang, d.prefSubLang),
    prefAudioLang: coerceStringArray(v.prefAudioLang, d.prefAudioLang),
    prefForced: coerceBoolean(v.prefForced, d.prefForced),
    preferSDH: coerceBoolean(v.preferSDH, d.preferSDH),
    dualSubs: coerceBoolean(v.dualSubs, d.dualSubs),
    subOffsetMs: typeof v.subOffsetMs === 'number' && Number.isFinite(v.subOffsetMs) ? Math.round(v.subOffsetMs) : d.subOffsetMs,
    subOffsetMs2: typeof v.subOffsetMs2 === 'number' && Number.isFinite(v.subOffsetMs2) ? Math.round(v.subOffsetMs2) : d.subOffsetMs2,
    subStyle: coerceSubStyle(v.subStyle, d.subStyle),
    subFilter: coerceSubFilter(v.subFilter, d.subFilter),
    backBuffer: coerceBackBuffer(v.backBuffer, d.backBuffer),
    lastBps: typeof v.lastBps === 'number' && Number.isFinite(v.lastBps) && v.lastBps > 0 ? Math.round(v.lastBps) : d.lastBps,
    parallelMp4: coerceBoolean(v.parallelMp4, d.parallelMp4),
    statsOpen: coerceBoolean(v.statsOpen, d.statsOpen),
  };
}

export function getPrefs(): PlayerPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PLAYER_PREFS, subStyle: { ...DEFAULT_PLAYER_PREFS.subStyle }, prefSubLang: [...DEFAULT_PLAYER_PREFS.prefSubLang], prefAudioLang: [...DEFAULT_PLAYER_PREFS.prefAudioLang] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PLAYER_PREFS, subStyle: { ...DEFAULT_PLAYER_PREFS.subStyle }, prefSubLang: [...DEFAULT_PLAYER_PREFS.prefSubLang], prefAudioLang: [...DEFAULT_PLAYER_PREFS.prefAudioLang] };
    const parsed = JSON.parse(raw);
    return coercePrefs(parsed);
  } catch {
    return { ...DEFAULT_PLAYER_PREFS, subStyle: { ...DEFAULT_PLAYER_PREFS.subStyle }, prefSubLang: [...DEFAULT_PLAYER_PREFS.prefSubLang], prefAudioLang: [...DEFAULT_PLAYER_PREFS.prefAudioLang] };
  }
}

const listeners = new Set<(prefs: PlayerPrefs) => void>();

export function setPrefs(patch: Partial<PlayerPrefs>): PlayerPrefs {
  const current = getPrefs();
  const mergedRaw = { ...current, ...patch } as Record<string, unknown>;
  // Strip session-only locked if present
  if ('locked' in mergedRaw) delete mergedRaw.locked;
  const next = coercePrefs(mergedRaw);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage full / private mode — degrade silently
    }
  }
  for (const fn of listeners) {
    try { fn(next); } catch {}
  }
  return next;
}

export function subscribePrefs(fn: (prefs: PlayerPrefs) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// For testing / internal reset
export function _resetListeners(): void {
  listeners.clear();
}
