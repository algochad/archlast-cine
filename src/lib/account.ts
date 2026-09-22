// Shared account-domain contract: NestJS backend (auth/) <-> Next.js app.
// Browser never talks to Nest directly: Next route handlers under
// /api/account/* forward to the Nest service (internal origin) and own the
// httpOnly `mb_token` cookie. Media items are mirror-images of the provider
// CatalogItem/MediaDetails so lists can render without extra fetches.

import type { MediaType } from "@/lib/media-types";

// Re-export the unified media model union ("movie" | "series" | "anime").
// Persisted account entries can now carry any of the three media types,
// including anime, since the anime subsystem writes entries.
export type { MediaType };

export type RegionId = "ph" | "us" | "in" | "sg";

export interface AccountUser {
  id: number;
  email: string;
  name: string;
  createdAt: string;
}

export interface AccountSettings {
  /** Streaming-market region; maps to a Rust backend in the region pool. */
  region: RegionId;
  /** Default content provider. */
  provider: "moviebox" | "fourkhdhub";
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
  /** Aligns with the unified MediaType ("movie" | "series" | "anime"). */
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
  /** Aligns with the unified MediaType ("movie" | "series" | "anime"). */
  mediaType: MediaType;
  year: string | null;
  addedAt: number;
}

export interface ReadingEntry {
  provider: string;
  id: string;
  title: string;
  poster: string | null;
  /** "manga" for the MangaScrapper reader. */
  mediaType: MediaType;
  year: string | null;
  chapter: number;
  /** 1-based page within the chapter (0 = unknown). */
  page: number;
  totalPages: number;
  /** Unix ms of last update. */
  updatedAt: number;
}

// ---- Nest v1 REST contract (internal, Bearer JWT) -------------------------
// POST /v1/auth/register {email,name,password} -> 201 AccountState
// POST /v1/auth/login     {email,password} -> {accessToken} & AccountState
// GET  /v1/users/me                       -> AccountState
// PATCH /v1/users/me {name?}              -> {user}
// PATCH /v1/users/me/settings {region?,provider?} -> {settings}
// GET  /v1/me/history                      -> {entries: WatchEntry[]}
// POST /v1/me/history {entry}              -> {entry} (upsert by p+id+s+e)
// POST /v1/me/history/import {entries}     -> {count}
// DELETE /v1/me/history?provider&id&season&episode -> 204
// GET  /v1/me/mylist                       -> {items: MyListItem[]}
// POST /v1/me/mylist {item}                -> {item} (idempotent)
// DELETE /v1/me/mylist?provider&id         -> 204
// Error shape: { statusCode, message }
export const REGION_IDS: RegionId[] = ["ph", "us", "in", "sg"];