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
  player?: PlayerPrefsSubset;
}

export interface PlayerPrefsSubset {
  seekStep?: 5 | 10 | 15 | 30 | 60;
  playbackRate?: number;
  autoplay?: boolean;
  prefSubLang?: string[];
  prefAudioLang?: string[];
  subStyle?: SubStyle;
  aspectMode?: 'contain' | 'cover' | 'fill';
}

export type PlayerPrefsDto = PlayerPrefsSubset;

export interface SubStyle {
  font: 'sans' | 'serif' | 'mono' | 'anime';
  weight: 'normal' | 'bold';
  scale: number;
  color: string;
  stroke: string;
  shadow: string;
  bg: string;
  bgOpacity: number;
  yOffset: number;
}

export const DEFAULT_SUB_STYLE: SubStyle = {
  font: 'sans',
  weight: 'normal',
  scale: 1,
  color: '#ffffff',
  stroke: '#000000',
  shadow: 'none',
  bg: '#000000',
  bgOpacity: 0.5,
  yOffset: 0,
};

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

export function toAccountSettings(user: { region: string; provider: string; settings?: unknown }): AccountSettings {
  const base: AccountSettings = {
    region: isRegionId(user.region) ? user.region : 'ph',
    provider: isProviderId(user.provider) ? user.provider : 'moviebox',
  };
  if (user.settings && typeof user.settings === 'object' && user.settings !== null) {
    const s = user.settings as Record<string, unknown>;
    if (s.player && typeof s.player === 'object' && s.player !== null) {
      const p = s.player as Record<string, unknown>;
      const player: PlayerPrefsSubset = {};
      if (typeof p.seekStep === 'number' && [5, 10, 15, 30, 60].includes(p.seekStep)) player.seekStep = p.seekStep as PlayerPrefsSubset['seekStep'];
      if (typeof p.playbackRate === 'number' && Number.isFinite(p.playbackRate)) player.playbackRate = p.playbackRate;
      if (typeof p.autoplay === 'boolean') player.autoplay = p.autoplay;
      if (Array.isArray(p.prefSubLang)) player.prefSubLang = p.prefSubLang.map(String);
      if (Array.isArray(p.prefAudioLang)) player.prefAudioLang = p.prefAudioLang.map(String);
      if (typeof p.aspectMode === 'string' && ['contain', 'cover', 'fill'].includes(p.aspectMode)) player.aspectMode = p.aspectMode as PlayerPrefsSubset['aspectMode'];
      if (p.subStyle && typeof p.subStyle === 'object' && p.subStyle !== null) player.subStyle = p.subStyle as SubStyle;
      if (Object.keys(player).length > 0) base.player = player;
    }
  }
  return base;
}

export function toAccountState(user: {
  id: number;
  email: string;
  name: string;
  region: string;
  provider: string;
  createdAt: Date;
  settings?: unknown;
}): AccountState {
  return { user: toAccountUser(user), settings: toAccountSettings(user) };
}
