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
  }, []);

  const updateSettings = useCallback(async (patch: { region?: string; provider?: string }) => {
    const updated = await accountApi.updateSettings(patch);
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
