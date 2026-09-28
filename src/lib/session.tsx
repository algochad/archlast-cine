"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { accountApi, AccountError, type WatchEntryInput } from "@/lib/api-account";
import type { AccountSettings, MyListItem, RegionId, WatchEntry } from "@/lib/account";
import type { HistoryApi, MyListState, SessionState } from "@/lib/session-contract";
import {
  getPrefs,
  setPrefs,
  subscribePrefs,
  extractSyncSubset,
  PLAYER_PREFS_SEEDED_KEY,
  PLAYER_PREFS_SEEDED_LEGACY_KEY,
} from "@/lib/player-prefs";
import type { PlayerPrefs } from "@/lib/player-prefs";

const DEFAULT_SETTINGS: AccountSettings = { region: "ph", provider: "moviebox" };

const REGION_IDS: RegionId[] = ["ph", "us", "in", "sg"];

/** My-list identity: a title is unique per (provider, id). */
function listKey(item: Pick<MyListItem, "provider" | "id">): string {
  return `${item.provider}:${item.id}`;
}

function upsertEntry(entries: WatchEntry[], entry: WatchEntry): WatchEntry[] {
  const key = (e: WatchEntry) => `${e.provider}:${e.id}:${e.season}:${e.episode}`;
  const next = entries.filter((e) => key(e) !== key(entry));
  return [...next, entry].sort((a, b) => b.updatedAt - a.updatedAt);
}

function entryMatches(
  entry: WatchEntry,
  provider: string,
  id: string,
  season?: number,
  episode?: number,
): boolean {
  if (entry.provider !== provider || entry.id !== id) return false;
  if (season !== undefined && entry.season !== season) return false;
  if (episode !== undefined && entry.episode !== episode) return false;
  return true;
}

export interface ServerHistory extends HistoryApi {
  entries: WatchEntry[];
  /** False until the first account fetch settles (anon settles immediately). */
  ready: boolean;
}

const SessionContext = createContext<SessionState | null>(null);
const MyListContext = createContext<MyListState | null>(null);
const HistoryContext = createContext<ServerHistory | null>(null);

/** Region mirrored in the non-httpOnly `mb_region` cookie (client-readable). */
export function readRegionCookie(): RegionId {
  if (typeof document === "undefined") return "ph";
  const match = document.cookie.match(/(?:^|;\s*)mb_region=([^;]+)/);
  const value = match?.[1] ?? "";
  return (REGION_IDS as string[]).includes(value) ? (value as RegionId) : "ph";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionState["user"]>(null);
  const [settings, setSettings] = useState<AccountSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [items, setItems] = useState<MyListItem[]>([]);
  const [listReady, setListReady] = useState(false);
  const [entries, setEntries] = useState<WatchEntry[]>([]);
  const [historyReady, setHistoryReady] = useState(false);

  // Callbacks read live state without depending on it (stable identities for
  // consumers like hover cards and the player).
  const statusRef = useRef(status);
  const itemsRef = useRef(items);
  useEffect(() => {
    statusRef.current = status;
    itemsRef.current = items;
  }, [status, items]);

  // ---- Player prefs sync: server-wins-with-local-seed (once) + 2s debounce push ----
  const prefsPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedSubsetRef = useRef<string>("");
  const seededAppliedRef = useRef(false);

  const schedulePrefsPush = useCallback((subset: ReturnType<typeof extractSyncSubset>) => {
    const serialized = JSON.stringify(subset);
    if (serialized === lastPushedSubsetRef.current) return;
    if (prefsPushTimerRef.current) clearTimeout(prefsPushTimerRef.current);
    prefsPushTimerRef.current = setTimeout(() => {
      prefsPushTimerRef.current = null;
      if (statusRef.current !== "authed") return;
      // Don't push empty subset on initial seed when server already had values
      lastPushedSubsetRef.current = serialized;
      void accountApi
        .updateSettings({ player: subset })
        .catch((err) => {
          console.warn("[session] player prefs sync failed:", err);
          // allow retry by resetting last pushed
          lastPushedSubsetRef.current = "";
        });
    }, 2000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const state = await accountApi.me();
      setUser({ id: state.user.id, email: state.user.email, name: state.user.name });
      setSettings(state.settings);
      setStatus("authed");
    } catch (err) {
      // 401 = signed out; anything else (service down) degrades to anon so the
      // catalog stays usable rather than blocking the whole app.
      if (!(err instanceof AccountError) || err.status !== 401) {
        console.warn("[session] account refresh failed:", err);
      }
      setUser(null);
      setStatus("anon");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // One-time merge: server-wins-with-local-seed via prefsSeeded flag
  useEffect(() => {
    if (status !== "authed") return;
    if (typeof window === "undefined") return;
    if (seededAppliedRef.current) return;
    // Flag stored as "1" once initial merge has run on this device
    const alreadySeeded =
      window.localStorage.getItem(PLAYER_PREFS_SEEDED_KEY) ||
      window.localStorage.getItem(PLAYER_PREFS_SEEDED_LEGACY_KEY);
    if (alreadySeeded) {
      seededAppliedRef.current = true;
      // Initialize lastPushed to current sync subset so first local edit is detected
      try {
        lastPushedSubsetRef.current = JSON.stringify(extractSyncSubset(getPrefs()));
      } catch {}
      return;
    }
    seededAppliedRef.current = true;
    try {
      const local = getPrefs();
      const serverPlayer = (settings as AccountSettings & { player?: Record<string, unknown> }).player;
      const hasServerPlayer = serverPlayer && typeof serverPlayer === "object" && Object.keys(serverPlayer).length > 0;

      if (hasServerPlayer) {
        // Server wins: merge server subset over local, preserving device-local keys
        const patch: Partial<PlayerPrefs> = {};
        const sp = serverPlayer as Record<string, unknown>;
        if (sp.seekStep !== undefined) patch.seekStep = sp.seekStep as PlayerPrefs["seekStep"];
        if (sp.playbackRate !== undefined) patch.playbackRate = sp.playbackRate as number;
        if (sp.autoplay !== undefined) patch.autoplay = sp.autoplay as boolean;
        if (Array.isArray(sp.prefSubLang)) patch.prefSubLang = (sp.prefSubLang as string[]).slice();
        if (Array.isArray(sp.prefAudioLang)) patch.prefAudioLang = (sp.prefAudioLang as string[]).slice();
        if (typeof sp.aspectMode === "string") patch.aspectMode = sp.aspectMode as PlayerPrefs["aspectMode"];
        if (sp.subStyle && typeof sp.subStyle === "object") patch.subStyle = { ...local.subStyle, ...(sp.subStyle as object) } as PlayerPrefs["subStyle"];
        if (Object.keys(patch).length > 0) {
          const merged = setPrefs(patch);
          lastPushedSubsetRef.current = JSON.stringify(extractSyncSubset(merged));
        } else {
          lastPushedSubsetRef.current = JSON.stringify(extractSyncSubset(local));
        }
      } else {
        // No server prefs yet: seed server with local sync subset
        const subset = extractSyncSubset(local);
        lastPushedSubsetRef.current = JSON.stringify(subset);
        schedulePrefsPush(subset);
      }
      window.localStorage.setItem(PLAYER_PREFS_SEEDED_KEY, "1");
      try { window.localStorage.setItem(PLAYER_PREFS_SEEDED_LEGACY_KEY, "1"); } catch {}
    } catch (err) {
      console.warn("[session] prefs merge failed:", err);
      try {
        window.localStorage.setItem(PLAYER_PREFS_SEEDED_KEY, "1");
        window.localStorage.setItem(PLAYER_PREFS_SEEDED_LEGACY_KEY, "1");
      } catch {}
    }
  }, [status, settings, schedulePrefsPush]);

  // Debounced push: subscribe to local prefs changes while authed
  useEffect(() => {
    if (status !== "authed") return;
    if (typeof window === "undefined") return;
    // Don't subscribe until initial seeded merge has run
    if (!seededAppliedRef.current) return;
    // Ensure lastPushed is initialized
    try {
      if (!lastPushedSubsetRef.current) lastPushedSubsetRef.current = JSON.stringify(extractSyncSubset(getPrefs()));
    } catch {}
    const unsub = subscribePrefs((next) => {
      const subset = extractSyncSubset(next);
      schedulePrefsPush(subset);
    });
    return () => {
      unsub();
      if (prefsPushTimerRef.current) {
        clearTimeout(prefsPushTimerRef.current);
        prefsPushTimerRef.current = null;
      }
    };
  }, [status, schedulePrefsPush]);

  // Reset seeded flag on logout so next sign-in re-seeds if needed
  // (kept device-local; logout clears to allow fresh merge on next auth)
  const clearSeededFlag = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(PLAYER_PREFS_SEEDED_KEY);
      try { window.localStorage.removeItem(PLAYER_PREFS_SEEDED_LEGACY_KEY); } catch {}
    } catch {}
    seededAppliedRef.current = false;
    lastPushedSubsetRef.current = "";
    if (prefsPushTimerRef.current) {
      clearTimeout(prefsPushTimerRef.current);
      prefsPushTimerRef.current = null;
    }
  }, []);

  // My list + server history follow the session: load on sign-in, clear on
  // sign-out. Anon settles immediately with empty state.
  useEffect(() => {
    if (status === "loading") return;
    if (status === "anon") {
      setItems([]);
      setListReady(true);
      setEntries([]);
      setHistoryReady(true);
      return;
    }
    let cancelled = false;
    setListReady(false);
    setHistoryReady(false);
    void (async () => {
      try {
        const list = await accountApi.mylist();
        if (!cancelled) setItems(list);
      } catch (err) {
        console.warn("[session] my list load failed:", err);
      } finally {
        if (!cancelled) setListReady(true);
      }
      try {
        const history = await accountApi.history();
        if (!cancelled) setEntries(history);
      } catch (err) {
        console.warn("[session] history load failed:", err);
      } finally {
        if (!cancelled) setHistoryReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const login = useCallback(async (email: string, password: string) => {
    const state = await accountApi.login({ email, password });
    setUser({ id: state.user.id, email: state.user.email, name: state.user.name });
    setSettings(state.settings);
    setStatus("authed");
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const state = await accountApi.register({ name, email, password });
    setUser({ id: state.user.id, email: state.user.email, name: state.user.name });
    setSettings(state.settings);
    setStatus("authed");
  }, []);

  const logout = useCallback(async () => {
    try {
      await accountApi.logout();
    } catch (err) {
      console.warn("[session] logout request failed:", err);
    }
    setUser(null);
    setSettings(DEFAULT_SETTINGS);
    setItems([]);
    setEntries([]);
    setListReady(true);
    setHistoryReady(true);
    setStatus("anon");
    clearSeededFlag();
  }, [clearSeededFlag]);

  const updateSettings = useCallback(async (patch: { region?: string; provider?: string; player?: import("@/lib/account").PlayerPrefsSubset }) => {
    const updated = await accountApi.updateSettings(patch as unknown as { region?: string; provider?: string });
    setSettings(updated);
  }, []);

  /** Re-read list/history from the account (used to recover from failed mutations). */
  const reloadList = useCallback(async () => {
    try {
      setItems(await accountApi.mylist());
    } catch (err) {
      console.warn("[session] my list reload failed:", err);
    }
  }, []);

  const toggle = useCallback(
    async (item: Parameters<MyListState["toggle"]>[0]) => {
      if (statusRef.current !== "authed") return;
      const key = listKey(item);
      const present = itemsRef.current.some((entry) => listKey(entry) === key);
      if (present) {
        setItems((prev) => prev.filter((entry) => listKey(entry) !== key));
        try {
          await accountApi.removeFromMyList(item.provider, item.id);
        } catch (err) {
          console.warn("[session] my list remove failed:", err);
          void reloadList();
        }
        return;
      }
      const optimistic: MyListItem = { ...item, addedAt: Date.now() };
      setItems((prev) => [optimistic, ...prev.filter((entry) => listKey(entry) !== key)]);
      try {
        const saved = await accountApi.addToMyList(item);
        setItems((prev) => [saved, ...prev.filter((entry) => listKey(entry) !== key)]);
      } catch (err) {
        console.warn("[session] my list add failed:", err);
        setItems((prev) => prev.filter((entry) => listKey(entry) !== key));
      }
    },
    [reloadList],
  );

  const record = useCallback(async (entry: WatchEntryInput) => {
    if (statusRef.current !== "authed") return;
    try {
      const saved = await accountApi.recordHistory(entry);
      setEntries((prev) => upsertEntry(prev, saved));
    } catch (err) {
      console.warn("[session] history record failed:", err);
    }
  }, []);

  const remove = useCallback(async (provider: string, id: string, season?: number, episode?: number) => {
    if (statusRef.current !== "authed") return;
    setEntries((prev) => prev.filter((entry) => !entryMatches(entry, provider, id, season, episode)));
    try {
      await accountApi.removeHistory(provider, id, season, episode);
    } catch (err) {
      console.warn("[session] history remove failed:", err);
    }
  }, []);

  const sessionValue = useMemo<SessionState>(
    () => ({ user, settings, status, refresh, login, register, logout, updateSettings }),
    [user, settings, status, refresh, login, register, logout, updateSettings],
  );

  const myListValue = useMemo<MyListState>(() => {
    const ids = new Set(items.map(listKey));
    return {
      ids,
      items,
      ready: listReady,
      toggle,
      has: (provider: string, id: string) => ids.has(`${provider}:${id}`),
    };
  }, [items, listReady, toggle]);

  const historyValue = useMemo<ServerHistory>(
    () => ({ entries, ready: historyReady, record, remove }),
    [entries, historyReady, record, remove],
  );

  return (
    <SessionContext.Provider value={sessionValue}>
      <MyListContext.Provider value={myListValue}>
        <HistoryContext.Provider value={historyValue}>{children}</HistoryContext.Provider>
      </MyListContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

export function useMyList(): MyListState {
  const value = useContext(MyListContext);
  if (!value) throw new Error("useMyList must be used inside <SessionProvider>");
  return value;
}

export function useServerHistory(): ServerHistory {
  const value = useContext(HistoryContext);
  if (!value) throw new Error("useServerHistory must be used inside <SessionProvider>");
  return value;
}
