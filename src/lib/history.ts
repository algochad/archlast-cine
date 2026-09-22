import type { MediaType, ProviderId } from "@/lib/types";

export interface WatchEntry {
  provider: ProviderId;
  id: string;
  title: string;
  poster: string | null;
  mediaType: MediaType;
  year: string | null;
  season: number;
  episode: number;
  /** Seconds watched. */
  position: number;
  /** Total duration in seconds (0 = unknown). */
  duration: number;
  updated: number;
}

const KEY = "moviebox.watch.v1";
const MAX_ENTRIES = 50;

export function entryKey(provider: ProviderId, id: string, season = 0, episode = 0): string {
  return `${provider}:${id}:${season}:${episode}`;
}

export function getHistory(): WatchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, WatchEntry>;
    return Object.values(parsed).sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

export function saveProgress(
  key: string,
  patch: Omit<WatchEntry, "updated">,
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    const map: Record<string, WatchEntry> = raw ? JSON.parse(raw) : {};
    const prev = map[key];
    // Finished watching: remove the row so it stops appearing.
    if (patch.duration > 0 && patch.position / patch.duration > 0.98) {
      delete map[key];
    } else {
      map[key] = { ...prev, ...patch, updated: Date.now() };
    }
    const entries = Object.values(map).sort((a, b) => b.updated - a.updated);
    if (entries.length > MAX_ENTRIES) {
      for (const dropped of entries.slice(MAX_ENTRIES)) delete map[entryKey(dropped.provider, dropped.id, dropped.season, dropped.episode)];
    }
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full / private mode — degrade silently */
  }
}

export function clearProgress(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, WatchEntry>;
    delete map[key];
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
