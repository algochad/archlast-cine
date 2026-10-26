/**
 * Account-domain contract shared by the Next.js app (`apps/web`) and the
 * NestJS account API (`apps/api`). The browser never talks to Nest directly:
 * Next route handlers under /api/account/* forward to the Nest service and own
 * the httpOnly `mb_token` cookie.
 *
 * Nest v1 REST surface (internal, Bearer JWT):
 *   POST   /v1/auth/register {email,name,password}      -> 201 AccountState
 *   POST   /v1/auth/login    {email,password}           -> {accessToken} & AccountState
 *   GET    /v1/users/me                                  -> AccountState
 *   PATCH  /v1/users/me {name?}                          -> {user}
 *   PATCH  /v1/users/me/settings {region?,provider?}     -> {settings}
 *   GET    /v1/me/history                                -> {entries: WatchEntry[]}
 *   POST   /v1/me/history {entry}                        -> {entry} (upsert by provider+id+season+episode)
 *   POST   /v1/me/history/import {entries}               -> {count}
 *   DELETE /v1/me/history?provider&id&season&episode     -> 204
 *   GET    /v1/me/mylist                                 -> {items: MyListItem[]}
 *   POST   /v1/me/mylist {item}                          -> {item} (idempotent)
 *   DELETE /v1/me/mylist?provider&id                     -> 204
 * Error shape: { statusCode, message }
 */

export const REGION_IDS = ["ph", "us", "in", "sg"] as const;
export type RegionId = (typeof REGION_IDS)[number];

/**
 * Sources an account may prefer by default. Viewers never see sources in the
 * UI (titles are source-agnostic); the field is kept for stored settings.
 */
export const PROVIDER_IDS = ["collaps", "moviebox", "fourkhdhub"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Unified media classification used by every surface. */
export const MEDIA_TYPES = ["movie", "series", "anime"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface AccountUser {
  id: number;
  email: string;
  name: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export interface SubStyle {
  font: "sans" | "serif" | "mono" | "anime";
  weight: "normal" | "bold";
  scale: number;
  color: string;
  stroke: string;
  shadow: string;
  bg: string;
  bgOpacity: number;
  yOffset: number;
}

export const DEFAULT_SUB_STYLE: SubStyle = {
  font: "sans",
  weight: "normal",
  scale: 1,
  color: "#ffffff",
  stroke: "#000000",
  shadow: "none",
  bg: "#000000",
  bgOpacity: 0.5,
  yOffset: 0,
};

export interface PlayerPrefsSubset {
  seekStep?: 5 | 10 | 15 | 30 | 60;
  playbackRate?: number;
  autoplay?: boolean;
  prefSubLang?: string[];
  prefAudioLang?: string[];
  subStyle?: SubStyle;
  aspectMode?: "contain" | "cover" | "fill";
}

export interface AccountSettings {
  /** Streaming-market region. */
  region: RegionId;
  /** Stored default source (not exposed in the UI). */
  provider: ProviderId;
  /** Synced player prefs subset (cross-device). Device-local prefs stay in localStorage only. */
  player?: PlayerPrefsSubset;
}

export interface AccountState {
  user: AccountUser;
  settings: AccountSettings;
}

export interface WatchEntry {
  provider: string;
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
  /** Unix ms of last update. */
  updatedAt: number;
}

export interface MyListItem {
  provider: string;
  id: string;
  title: string;
  poster: string | null;
  mediaType: MediaType;
  year: string | null;
  /** Unix ms. */
  addedAt: number;
}

export function isRegionId(value: string): value is RegionId {
  return (REGION_IDS as readonly string[]).includes(value);
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function isMediaType(value: string): value is MediaType {
  return (MEDIA_TYPES as readonly string[]).includes(value);
}
