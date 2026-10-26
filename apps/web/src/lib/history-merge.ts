import type { WatchEntry } from "@/lib/account";

/** Local key for anonymous / last-sync watch history. */
const LOCAL_KEY = "moviebox.watch.v1";

export function entryKey(p: string, id: string, season = 0, episode = 0): string {
  return `${p}:${id}:${season}:${episode}`;
}

/** Stable merge: server history is canonical; local fills rows the server lacks. */
export function mergeEntries(server: WatchEntry[], local: WatchEntry[]): WatchEntry[] {
  const map = new Map<string, WatchEntry>();
  const latest = new Map<string, number>();
  for (const e of [...server, ...local]) {
    const k = entryKey(e.provider, e.id, e.season, e.episode);
    const upd = e.updatedAt ?? 0;
    if (upd >= (latest.get(k) ?? 0)) {
      latest.set(k, upd);
      map.set(k, e);
    }
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
