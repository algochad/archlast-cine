import type { MediaType, ProviderId } from "@/lib/types";

export interface ReadingEntry {
  provider: ProviderId;
  id: string;
  title: string;
  poster: string | null;
  mediaType: MediaType;
  year: string | null;
  chapter: number;
  /** 1-based page index within the chapter (0 = unknown). */
  page: number;
  totalPages: number;
  updated: number;
}

const KEY = "moviebox.read.v1";
const MAX_ENTRIES = 50;

export function readingKey(provider: ProviderId, id: string, chapter = 0): string {
  return `${provider}:${id}:${chapter}`;
}

export function getReadingHistory(): ReadingEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, ReadingEntry>;
    return Object.values(parsed).sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

export function saveReadingProgress(
  key: string,
  patch: Omit<ReadingEntry, "updated">,
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    const map: Record<string, ReadingEntry> = raw ? JSON.parse(raw) : {};
    const prev = map[key];
    // Finished chapter: remove the row so it stops appearing.
    if (patch.totalPages > 0 && patch.page >= patch.totalPages) {
      delete map[key];
    } else {
      map[key] = { ...prev, ...patch, updated: Date.now() };
    }
    const entries = Object.values(map).sort((a, b) => b.updated - a.updated);
    if (entries.length > MAX_ENTRIES) {
      for (const dropped of entries.slice(MAX_ENTRIES))
        delete map[readingKey(dropped.provider, dropped.id, dropped.chapter)];
    }
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full / private mode — degrade silently */
  }
}

export function clearReadingProgress(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, ReadingEntry>;
    delete map[key];
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}