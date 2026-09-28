/** Account-domain types mirrored from src/lib/account.ts (shared REST contract). */

export const REGION_IDS = ['ph', 'us', 'in', 'sg'] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const PROVIDER_IDS = ['moviebox', 'fourkhdhub'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const MEDIA_TYPES = ['movie', 'series', 'anime'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface AccountUser {
  id: number;
  email: string;
  name: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export interface AccountSettings {
  region: RegionId;
  provider: ProviderId;
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
  addedAt: number;
}

export function isRegionId(value: string): value is RegionId {
  return (REGION_IDS as readonly string[]).includes(value);
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function toAccountUser(user: {
  id: number;
  email: string;
  name: string;
  createdAt: Date;
}): AccountUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toAccountSettings(user: { region: string; provider: string }): AccountSettings {
  return {
    region: isRegionId(user.region) ? user.region : 'ph',
    provider: isProviderId(user.provider) ? user.provider : 'moviebox',
  };
}

export function toAccountState(user: {
  id: number;
  email: string;
  name: string;
  region: string;
  provider: string;
  createdAt: Date;
}): AccountState {
  return { user: toAccountUser(user), settings: toAccountSettings(user) };
}
