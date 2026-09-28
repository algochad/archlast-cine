import type { Season } from "@/lib/types";

export interface EpisodeRef {
  season: number;
  episode: number;
}

/**
 * Find previous episode relative to (s,e).
 * - Same season episode-1 if exists
 * - Otherwise last episode of previous season (season-1, or nearest lower number)
 * - null at bounds
 */
export function prevEpisode(seasons: Season[], s: number, e: number): EpisodeRef | null {
  if (!Array.isArray(seasons) || seasons.length === 0) return null;
  const current = seasons.find((x) => x.number === s);
  if (!current) return null;
  const idx = current.episodes.findIndex((ep) => ep.number === e);
  if (idx === -1) return null;
  if (idx > 0) {
    const prev = current.episodes[idx - 1];
    return { season: s, episode: prev.number };
  }
  const candidates = seasons
    .filter((x) => x.number < s)
    .sort((a, b) => b.number - a.number);
  for (const cand of candidates) {
    if (cand.episodes.length > 0) {
      const last = cand.episodes[cand.episodes.length - 1];
      return { season: cand.number, episode: last.number };
    }
  }
  return null;
}

/**
 * Find next episode relative to (s,e).
 * - Same season episode+1 if exists
 * - Otherwise first episode of next season (season+1, or nearest higher number)
 * - null at bounds
 */
export function nextEpisode(seasons: Season[], s: number, e: number): EpisodeRef | null {
  if (!Array.isArray(seasons) || seasons.length === 0) return null;
  const current = seasons.find((x) => x.number === s);
  if (!current) return null;
  const idx = current.episodes.findIndex((ep) => ep.number === e);
  if (idx === -1) return null;
  if (idx + 1 < current.episodes.length) {
    const next = current.episodes[idx + 1];
    return { season: s, episode: next.number };
  }
  const candidates = seasons
    .filter((x) => x.number > s)
    .sort((a, b) => a.number - b.number);
  for (const cand of candidates) {
    if (cand.episodes.length > 0) {
      const first = cand.episodes[0];
      return { season: cand.number, episode: first.number };
    }
  }
  return null;
}
