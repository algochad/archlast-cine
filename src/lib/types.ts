// Typed mirror of the Rust backend's JSON contract
// (moviebox_tui::providers::models + server responses).

export type ProviderId = "moviebox" | "fourkhdhub" | "bdix_circleftp" | "bdix_dhakaflix" | "addons" | "anime" | "manga";

export interface ProviderRef {
  provider: ProviderId;
  value: string;
}

export type MediaType = "movie" | "series" | "anime" | "manga";

export interface CatalogItem {
  id: ProviderRef;
  title: string;
  media_type: MediaType;
  year: string | null;
  poster_url: string | null;
  season_count: number | null;
}

export interface BrowseMetrics {
  trending?: number | null;
  rating?: number | null;
  recent_rating?: number | null;
  popularity?: number | null;
}

export interface Episode {
  season: number;
  number: number;
  title: string | null;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface Dub {
  subject_id: string;
  language: string;
  label: string;
}

export interface MediaDetails {
  id: ProviderRef;
  title: string;
  media_type: MediaType;
  year: string | null;
  description: string | null;
  tagline: string | null;
  imdb_rating: string | null;
  director: string | null;
  stars: string | null;
  prints: string | null;
  audios: string | null;
  poster_url: string | null;
  duration: string | null;
  genres: string[];
  seasons: Season[];
  dubs: Dub[];
  /** Anime-specific metadata; present only when the provider supplies it. */
  anime?: AnimeDetailsBlock | null;
}

export interface AnimeDetailsBlock {
  /** Production studios. */
  studios?: string[];
  /** Broadcast season (WINTER/SPRING/SUMMER/FALL). */
  season?: string | null;
  /** Broadcast year. */
  season_year?: number | null;
  /** AniList airing status (RELEASING/FINISHED/NOT_YET_RELEASED/CANCELLED/HIATUS). */
  status?: string | null;
}

export interface SourceMirror {
  label: string;
  resolver_url: string;
  headers: [string, string][];
  direct_file: boolean;
}

export interface Release {
  provider: ProviderId;
  filename: string;
  quality: string | null;
  codec: string | null;
  language: string | null;
  size_bytes: number | null;
  season: number | null;
  episode: number | null;
  mirrors: SourceMirror[];
  resource_id: string | null;
}

export interface SubtitleOption {
  name: string;
  url: string;
}

export interface HomeResponse {
  tab: string;
  page: number;
  items: CatalogItem[];
  metrics: Record<string, BrowseMetrics>;
}

export interface SearchResponse {
  provider: ProviderId;
  query: string;
  page: number;
  items: CatalogItem[];
}

export interface DetailsResponse {
  provider: ProviderId;
  id: string;
  details: MediaDetails;
}

export interface StreamsResponse {
  provider: ProviderId;
  id: string;
  season: number;
  episode: number;
  releases: Release[];
}

export interface PlayResponse {
  provider: ProviderId;
  id: string;
  season: number;
  episode: number;
  release: Release;
  mirror_label: string;
  direct_file: boolean;
  requires_headers: boolean;
  play_url: string;
}

/** Response of POST /transcode/start for an HEVC-only source. */
export interface TranscodeStartResponse {
  session: string;
  m3u8_url: string;
}

export interface CaptionsResponse {
  id: string;
  subtitles: SubtitleOption[];
}

// ── Manga (MangaScrapper-backed reader content) ─────────────────────────────

export interface MangaChapterSummary {
  id: string;
  number: number;
  language: string;
  uploadDate: string | null;
  totalPages: number;
}

export interface MangaChapterPage {
  url: string | null;
  width: number;
  height: number;
  alternateUrl: string | null;
  isFallback: boolean;
}

export interface MangaChapter {
  id: string;
  number: number;
  language: string;
  uploadDate: string | null;
  totalPages: number;
  pages: MangaChapterPage[];
}

export interface MangaTrendingResponse {
  sort: string;
  page: number;
  items: CatalogItem[];
}

export interface MangaChaptersResponse {
  id: string;
  chapters: MangaChapterSummary[];
}

export interface MangaChapterDetailResponse {
  id: string;
  chapter: MangaChapter;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  providers: {
    key: ProviderId;
    label: string;
    capabilities: {
      supports_search: boolean;
      supports_pagination: boolean;
      supports_series: boolean;
      supports_subtitles: boolean;
      supports_homepage: boolean;
    };
  }[];
}

export interface ApiErrorShape {
  error: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
