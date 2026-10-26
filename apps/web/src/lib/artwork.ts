// Artwork derived from stable IMDb ids (Metahub CDN, keyless). Titles that do
// not come from the IMDb-keyed catalog simply have no landscape art and fall
// back to their poster.

import type { ProviderId } from "@/lib/types";

const METAHUB = "https://images.metahub.space";
const EPISODES = "https://episodes.metahub.space";
const IMDB_ID = /^tt\d{3,12}$/;

function imdbOf(provider: ProviderId | string, id: string): string | null {
  return provider === "collaps" && IMDB_ID.test(id) ? id : null;
}

/** 1920x1080 landscape backdrop, or null when the title has none. */
export function backdropUrl(provider: ProviderId | string, id: string): string | null {
  const imdb = imdbOf(provider, id);
  return imdb ? `${METAHUB}/background/medium/${imdb}/img` : null;
}

/** Transparent title-treatment logo, or null. */
export function logoUrl(provider: ProviderId | string, id: string): string | null {
  const imdb = imdbOf(provider, id);
  return imdb ? `${METAHUB}/logo/medium/${imdb}/img` : null;
}

/** Poster at catalog quality, or null. */
export function posterUrl(provider: ProviderId | string, id: string): string | null {
  const imdb = imdbOf(provider, id);
  return imdb ? `${METAHUB}/poster/medium/${imdb}/img` : null;
}

/** 16:9 still for one episode, or null. */
export function episodeStillUrl(
  provider: ProviderId | string,
  id: string,
  season: number,
  episode: number,
): string | null {
  const imdb = imdbOf(provider, id);
  if (!imdb || !Number.isInteger(season) || !Number.isInteger(episode) || season < 0 || episode < 1) return null;
  return `${EPISODES}/${imdb}/${season}/${episode}/w780.jpg`;
}
