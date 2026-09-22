import type { MediaType } from "@/lib/media-types";
// Account session + data hooks contract — implemented by the auth agent.
// Consumed by nav / hover cards / detail / watch pages. All network calls go
// through /api/account/* (Next route handlers proxy to the Nest backend and
// own the httpOnly `mb_token` cookie).

export interface SessionState {
  user: {
    id: number;
    email: string;
    name: string;
  } | null;
  settings: { region: "ph" | "us" | "in" | "sg"; provider: string };
  /** one of: 'loading' | 'anon' | 'authed' */
  status: "loading" | "anon" | "authed";
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateSettings: (patch: { region?: string; provider?: string }) => Promise<void>;
}

export interface MyListState {
  ids: Set<string>;
  items: import("@/lib/account").MyListItem[];
  ready: boolean;
  toggle: (item: {
    provider: string;
    id: string;
    title: string;
    poster: string | null;
    mediaType: MediaType;
    year: string | null;
  }) => Promise<void>;
  has: (provider: string, id: string) => boolean;
}

export interface HistoryApi {
  record: (entry: {
    provider: string;
    id: string;
    title: string;
    poster: string | null;
    mediaType: MediaType;
    season: number;
    episode: number;
    position: number;
    duration: number;
    year: string | null;
  }) => Promise<void>;
  remove: (provider: string, id: string, season?: number, episode?: number) => Promise<void>;
}
