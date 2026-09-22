"use client";

/**
 * Account-aware watch-progress bridge.
 *
 * Progress is *always* written to the local store (anonymous fallback and the
 * offline resume source). When a signed-in session is active the same patch is
 * also pushed to the account store, throttled per title so scrubbing cannot
 * turn into a request storm, and force-flushed on pause / unmount. A failed or
 * dropped sync is never fatal: the local copy stays authoritative for
 * playback and the next tick catches up.
 *
 * The server side is injected (see `setWatchSyncTransport`): the player wires
 * the session's server-history API (`useServerHistory().record/.remove`, which
 * POST/DELETE `/api/account/history`) so the account cache that the history
 * page and Continue Watching read stays in step with these writes.
 */

import { clearProgress, entryKey, saveProgress, type WatchEntry } from "@/lib/history";

/** Max frequency of server upserts for one title. Local writes are never throttled. */
export const SERVER_SYNC_INTERVAL_MS = 8_000;

/** A progress patch as persisted locally (the server stamps its own `updatedAt`). */
export type WatchProgress = Omit<WatchEntry, "updated">;

/** Server-side half of the bridge, bound by the player from the session. */
export interface WatchSyncTransport {
  /** Upsert one entry (fire-and-forget; must not throw). */
  record: (patch: WatchProgress) => void;
  /** Remove one entry. */
  remove: (provider: string, id: string, season: number, episode: number) => void;
}

let transport: WatchSyncTransport | null = null;

/** Wire the account transport; pass null on unmount. */
export function setWatchSyncTransport(next: WatchSyncTransport | null): void {
  transport = next;
}

/** Last server upsert time per entry key. */
const lastSyncAt = new Map<string, number>();

/** Pure throttle decision — `force` (pause / unmount) always syncs. */
export function syncDue(lastSync: number | undefined, now: number, force = false): boolean {
  if (force) return true;
  return lastSync === undefined || now - lastSync >= SERVER_SYNC_INTERVAL_MS;
}

/**
 * Persist watch progress for one entry.
 *
 * @param patch  progress row (same shape the local store persists)
 * @param authed whether an account session is active (otherwise local-only)
 * @param force  bypass the server throttle (pause / unmount flush)
 */
export function recordWatch(patch: WatchProgress, authed: boolean, force = false): void {
  const key = entryKey(patch.provider, patch.id, patch.season, patch.episode);
  saveProgress(key, patch);
  if (!authed || !transport) return;
  // The local store drops finished rows; keep the account store in step
  // instead of upserting a row that reads as complete.
  if (patch.duration > 0 && patch.position / patch.duration > 0.98) {
    removeWatch(patch.provider, patch.id, patch.season, patch.episode, true);
    return;
  }
  const now = Date.now();
  if (!syncDue(lastSyncAt.get(key), now, force)) return;
  lastSyncAt.set(key, now);
  transport.record(patch);
}

/**
 * Drop one entry everywhere: the local row always, the server row only when
 * signed in. Called when a title is watched to the end, so finished rows
 * disappear from Continue Watching on both sides.
 */
export function removeWatch(
  provider: WatchEntry["provider"],
  id: string,
  season = 0,
  episode = 0,
  authed = false,
): void {
  const key = entryKey(provider, id, season, episode);
  clearProgress(key);
  lastSyncAt.delete(key);
  if (!authed || !transport) return;
  transport.remove(provider, id, season, episode);
}
