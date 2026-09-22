// Unified media model (Anime Integration Plan, Phase 2).
// Single source of truth for the media domain shared by the Next.js web app,
// the Rust backend, and the TUI. Every type here is JSON-serializable
// (plain strings/numbers/booleans/arrays — no Date, Map, or class instances)
// so the same shape crosses the TS <-> Rust/TUI boundary untouched.
// camelCase on the wire; Rust re-serializes to snake_case internally.
//
// Anime specifics live ONLY in `AnimeMetadata`, an optional block on `Media`:
// movie/series code never reads, writes, or depends on it.

/** Coarse media classification shared by every surface. */
export type MediaType = "movie" | "series" | "anime" | "manga";

/** Providers that can serve media data. */
export type ProviderSource =
  | "moviebox"
  | "fourkhdhub"
  | "bdix_circleftp"
  | "bdix_dhakaflix"
  | "addons"
  | "anime"
  | "manga";

/** Broadcast season anime metadata uses (AniList convention). */
export type AnimeSeason = "winter" | "spring" | "summer" | "fall";

/** Airing status, AniList convention lowercased. */
export type AnimeStatus =
  | "releasing"
  | "finished"
  | "not_yet_released"
  | "cancelled"
  | "hiatus";

/** How one anime entry relates to another (AniList relation edges). */
export type AnimeRelationType =
  | "prequel"
  | "sequel"
  | "parent"
  | "side_story"
  | "spin_off"
  | "adaptation"
  | "summary"
  | "character"
  | "source"
  | "alternative"
  | "other";

/** Cross-reference to another anime entry. */
export interface AnimeRelation {
  type: AnimeRelationType;
  /** AniList media ID of the related entry, if known. */
  anilistId?: number;
  /** MyAnimeList ID of the related entry, if known. */
  malId?: number;
  /** Display title of the related entry. */
  title: string;
}

/**
 * Anime-only metadata. Entirely optional: present only when
 * `Media.type === "anime"` and the provider supplied the data.
 * Movie/series flows never touch this block.
 */
export interface AnimeMetadata {
  /** AniList media ID. */
  anilistId?: number;
  /** MyAnimeList anime ID. */
  malId?: number;
  /** Production studios. */
  studios?: string[];
  /** Broadcast season for the covered year. */
  season?: AnimeSeason;
  /** Total episode count (planned or final); null while unknown. */
  episodeCount?: number | null;
  /** Current airing status. */
  status?: AnimeStatus;
  /** Related anime (sequels, prequels, spin-offs, source material, ...). */
  relations?: AnimeRelation[];
}

/**
 * A single browsable/playable media item — movie, TV series, or anime.
 * One flat shape for all three: `type` discriminates and anime
 * specifics live in the optional `animeMetadata` block.
 */
export interface Media {
  /** Provider-scoped identifier (unique together with `provider`). */
  id: string;
  type: MediaType;
  /** Provider that served this item. */
  provider: ProviderSource;
  title: string;
  poster?: string | null;
  backdrop?: string | null;
  description?: string | null;
  /** Release year. */
  year?: number | null;
  genres?: string[];
  /** Present only for anime with provider-supplied metadata. */
  animeMetadata?: AnimeMetadata;
}

/**
 * One episode of a series or anime. `season` is omitted for anime
 * that number episodes flat across the whole run.
 */
export interface Episode {
  /** Episode identifier, unique within its media. */
  id: string;
  /** `Media.id` this episode belongs to. */
  mediaId: string;
  /** Season number; omit for flat-numbered anime. */
  season?: number;
  /** Episode number within the season (or the whole run when flat). */
  number: number;
  title?: string | null;
  description?: string | null;
  thumbnail?: string | null;
}

/** Player container format tag — the three the existing player handles. */
export type StreamFormat = "hls" | "dash" | "mp4";

/** Subtitle track the player can load alongside a stream. */
export interface Subtitle {
  /** Language tag or provider language code. */
  language: string;
  /** URL of the subtitle file. */
  url: string;
  /** Human-readable track label (e.g. "English (SDH)"). */
  label?: string;
}

/**
 * A resolved, playable stream. The player consumes this the same way
 * regardless of media type.
 */
export interface Stream {
  /** Stream identifier, unique within its episode/media. */
  id: string;
  /** Direct playable URL. */
  url: string;
  /** Quality label (e.g. "1080p"); null when unknown. */
  quality?: string | null;
  format: StreamFormat;
  /** Optional subtitle tracks for this stream. */
  subtitles?: Subtitle[];
}