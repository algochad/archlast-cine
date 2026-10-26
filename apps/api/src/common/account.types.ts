/**
 * Account-domain types live in `@archlast/contracts` (shared with the web app).
 * This module re-exports them and adds the server-only row -> contract mappers.
 */
import {
  isProviderId,
  isRegionId,
  type AccountSettings,
  type AccountState,
  type AccountUser,
  type PlayerPrefsSubset,
  type SubStyle,
} from '@archlast/contracts';

export * from '@archlast/contracts';

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
