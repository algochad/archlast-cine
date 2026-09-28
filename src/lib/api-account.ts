// Browser-side helpers for the account surface. Every call goes through the
// same-origin /api/account/* route handlers, which proxy to the Nest service
// and own the httpOnly session cookie — the client never sees a token.

import type {
  AccountSettings,
  AccountState,
  AccountUser,
  MyListItem,
  RegionId,
  WatchEntry,
} from "@/lib/account";

export interface AccountConfig {
  availableRegions: RegionId[];
  defaultRegion: RegionId;
}

/** A watch entry as the client sends it (the server stamps updatedAt). */
export type WatchEntryInput = Omit<WatchEntry, "updatedAt">;

export class AccountError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AccountError";
    this.status = status;
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/account${path}`, {
    credentials: "same-origin",
    ...init,
    headers: init?.body ? JSON_HEADERS : undefined,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const message = typeof payload?.error === "string" ? payload.error : `Request failed (HTTP ${res.status})`;
    throw new AccountError(message, res.status);
  }
  if (res.status === 204 || res.status === 205) return undefined as T;
  return (await res.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Bulk upload of local/desktop history into the account; idempotent upsert. */
export function importHistory(entries: WatchEntryInput[]): Promise<{ count: number }> {
  return request<{ count: number }>("/history/import", {
    method: "POST",
    body: JSON.stringify({ entries }),
  });
}

export const accountApi = {
  config: () => request<AccountConfig>("/config"),

  register: (input: { name: string; email: string; password: string }) =>
    request<AccountState>("/register", { method: "POST", body: JSON.stringify(input) }),

  login: (input: { email: string; password: string }) =>
    request<AccountState>("/login", { method: "POST", body: JSON.stringify(input) }),

  logout: () => request<{ ok: boolean }>("/logout", { method: "POST" }),

  me: () => request<AccountState>("/me"),

  updateSettings: async (patch: { region?: string; provider?: string }) =>
    (await request<{ settings: AccountSettings }>("/settings", { method: "PATCH", body: JSON.stringify(patch) }))
      .settings,

  updateName: async (name: string) =>
    (await request<{ user: AccountUser }>("/me", { method: "PATCH", body: JSON.stringify({ name }) })).user,

  history: async () => (await request<{ entries: WatchEntry[] }>("/history")).entries,

  recordHistory: async (entry: WatchEntryInput) =>
    (await request<{ entry: WatchEntry }>("/history", { method: "POST", body: JSON.stringify({ entry }) })).entry,

  importHistory,

  removeHistory: (provider: string, id: string, season?: number, episode?: number) =>
    request<void>(`/history${query({ provider, id, season, episode })}`, { method: "DELETE" }),

  mylist: async () => (await request<{ items: MyListItem[] }>("/mylist")).items,

  addToMyList: async (item: Omit<MyListItem, "addedAt">) =>
    (await request<{ item: MyListItem }>("/mylist", { method: "POST", body: JSON.stringify({ item }) })).item,

  removeFromMyList: (provider: string, id: string) =>
    request<void>(`/mylist${query({ provider, id })}`, { method: "DELETE" }),
};
