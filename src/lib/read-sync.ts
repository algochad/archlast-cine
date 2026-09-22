"use client";

/**
 * Account-aware reading-progress bridge (manga reader counterpart of
 * watch-sync.ts). Progress is always written to the local store; when a
 * signed-in session is active the same patch is also pushed to the account
 * store, throttled per title and force-flushed when a chapter ends or the
 * reader unmounts. A failed sync is never fatal: the local copy stays
 * authoritative and the next tick catches up.
 */

import {
  clearReadingProgress,
  readingKey,
  saveReadingProgress,
  type ReadingEntry,
} from "@/lib/manga-history";
import { accountApi, type ReadingEntryInput } from "@/lib/api-account";

/** Max frequency of server upserts for one title. Local writes are never throttled. */
export const SERVER_SYNC_INTERVAL_MS = 8_000;

/** A progress patch as persisted locally (the server stamps its own `updatedAt`). */
export type ReadingProgress = Omit<ReadingEntry, "updated">;

let authed = false;

/** Wire session state; the reader updates this on mount/session change. */
export function setReadingSyncAuthed(next: boolean): void {
  authed = next;
}

/** Last server upsert time per entry key. */
const lastSyncAt = new Map<string, number>();

/** Pure throttle decision — `force` (chapter end / unmount) always syncs. */
export function syncDue(lastSync: number | undefined, now: number, force = false): boolean {
  if (force) return true;
  return lastSync === undefined || now - lastSync >= SERVER_SYNC_INTERVAL_MS;
}

/**
 * Persist reading progress for one entry. When the chapter is finished the
 * local row is dropped so it stops appearing in Continue Reading; the server
 * row is removed too (when authed) instead of upserting a completed entry.
 */
export function recordReading(patch: ReadingProgress, force = false): void {
  const key = readingKey(patch.provider, patch.id, patch.chapter);
  const finished = patch.totalPages > 0 && patch.page >= patch.totalPages;
  if (finished) {
    clearReadingProgress(key);
    lastSyncAt.delete(key);
    if (authed) {
      void accountApi.removeReadingHistory(patch.provider, patch.id, patch.chapter).catch(() => undefined);
    }
    return;
  }
  saveReadingProgress(key, patch);
  if (!authed) return;
  const now = Date.now();
  if (!syncDue(lastSyncAt.get(key), now, force)) return;
  lastSyncAt.set(key, now);
  void accountApi.recordReading(patch as ReadingEntryInput).catch(() => undefined);
}

/**
 * Drop one entry everywhere (local always, server only when signed in).
 */
export function removeReading(
  provider: ReadingEntry["provider"],
  id: string,
  chapter = 0,
): void {
  const key = readingKey(provider, id, chapter);
  clearReadingProgress(key);
  lastSyncAt.delete(key);
  if (!authed) return;
  void accountApi.removeReadingHistory(provider, id, chapter).catch(() => undefined);
}

/** Bulk upload of local rows after sign-in; idempotent upsert. */
export async function importLocalReading(entries: ReadingEntry[]): Promise<void> {
  if (!authed || entries.length === 0) return;
  const payload: ReadingEntryInput[] = entries.map(({ updated: _updated, ...rest }) => rest);
  await accountApi.importReadingHistory(payload);
}