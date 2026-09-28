import {
  ApiError,
  ApiErrorShape,
  CaptionsResponse,
  DetailsResponse,
  HealthResponse,
  HomeResponse,
  PlayResponse,
  ProviderId,
  SearchResponse,
  StreamsResponse,
  TranscodeStartResponse,
} from "@/lib/types";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/mb${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...JSON_HEADERS },
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ApiErrorShape;
      if (body?.error) message = body.error;
    } catch {
      /* non-json body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>("/health"),
  home: (tab = "2", page = 1) => request<HomeResponse>(`/home?tab=${tab}&page=${page}`),
  search: (q: string, provider: ProviderId = "moviebox", page = 1) =>
    request<SearchResponse>(`/search?q=${encodeURIComponent(q)}&provider=${provider}&page=${page}`),
  suggest: (q: string) => request<{ query: string; suggestions: string[] }>(`/suggest?q=${encodeURIComponent(q)}`),
  details: (provider: ProviderId, id: string) =>
    request<DetailsResponse>(`/details?provider=${provider}&id=${encodeURIComponent(id)}`),
  streams: (provider: ProviderId, id: string, season = 0, episode = 0) =>
    request<StreamsResponse>(
      `/streams?provider=${provider}&id=${encodeURIComponent(id)}&season=${season}&episode=${episode}`,
    ),
  captions: (id: string) => request<CaptionsResponse>(`/captions?id=${encodeURIComponent(id)}`),
  play: (body: {
    provider: ProviderId;
    id: string;
    season?: number;
    episode?: number;
    resolution?: number;
  }) =>
    request<PlayResponse>("/play", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Start a live server-side transcode of an HEVC-only source. */
  transcodeStart: (ticket: string) =>
    request<TranscodeStartResponse>("/transcode/start", {
      method: "POST",
      body: JSON.stringify({ ticket }),
    }),
  /** Status of an in-flight transcode session. */
  transcodeState: (session: string) =>
    request<TranscodeStateResponse>(`/transcode/${encodeURIComponent(session)}/state`),
  /**
   * Restart the transcode pipeline at an absolute source offset. The session
   * id is kept; the child is killed, old segments/playlist are wiped and a
   * fresh playlist begins at the seek point. 409 while a restart is already
   * in flight, 422 when the offset is at/beyond the source duration.
   */
  transcodeSeek: (session: string, positionSeconds: number) =>
    request<TranscodeSeekResponse>(`/transcode/${encodeURIComponent(session)}/seek`, {
      method: "POST",
      body: JSON.stringify({ position_seconds: positionSeconds }),
    }),
  /** Stop and remove a transcode session (fire-and-forget friendly). */
  transcodeDelete: (session: string) =>
    request<{ removed: boolean }>(`/transcode/${encodeURIComponent(session)}`, {
      method: "DELETE",
    }),
};

/** Status of an in-flight transcode session. */
export interface TranscodeStateResponse {
  session: string;
  running: boolean;
  ready: boolean;
  segments: number;
  ticket: string;
  /** True while a seek-restart is wiping/rebuilding the pipeline. */
  restarting: boolean;
  /** Total runtime of the source in seconds (from the MPD), null when unavailable. */
  duration_seconds: number | null;
  /** Seconds of media transcoded so far (EXTINF sum of the live playlist). */
  produced_seconds: number;
}

/** Response of POST /transcode/{session}/seek. */
export interface TranscodeSeekResponse {
  session: string;
  m3u8_url: string;
  duration_seconds: number | null;
  /** Content-absolute position the new pipeline starts at (the seek offset). */
  produced_seconds: number;
  restarting: false;
}

/**
 * Convert a backend-relative path (e.g. the transcode `m3u8_url`
 * `/api/transcode/<session>/index.m3u8`) into the same-origin browser URL that
 * next.config.ts rewrites back to the backend (`/api/mb/transcode/...`).
 */
export function mbUrl(backendPath: string): string {
  return backendPath.startsWith("/api/") ? `/api/mb${backendPath.slice("/api".length)}` : backendPath;
}
