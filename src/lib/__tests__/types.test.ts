import { describe, it, expect } from "vitest";
import { ApiError } from "../types";
import type {
  ApiErrorShape,
  BrowseMetrics,
  CaptionsResponse,
  CatalogItem,
  DetailsResponse,
  HealthResponse,
  HomeResponse,
  PlayResponse,
  ProviderId,
  SearchResponse,
  StreamsResponse,
  TranscodeStartResponse,
} from "../types";

describe("ApiError", () => {
  it("carries status and message", () => {
    const err = new ApiError(404, "not found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
    expect(err).toBeInstanceOf(Error);
  });
  it("names itself ApiError", () => {
    expect(new ApiError(500, "x").name).toBe("ApiError");
  });
  it("keeps each HTTP status distinct", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 500, 503]) {
      expect(new ApiError(status, "m").status).toBe(status);
    }
  });
  it("preserves unicode and empty messages", () => {
    expect(new ApiError(400, "日本語 🎬").message).toBe("日本語 🎬");
    expect(new ApiError(400, "").message).toBe("");
  });
  it("preserves oversize messages verbatim", () => {
    const big = "e".repeat(10_000);
    expect(new ApiError(500, big).message).toBe(big);
  });
  it("supports instanceof checks after construction", () => {
    const err: unknown = new ApiError(422, "bad offset");
    expect(err instanceof ApiError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe("backend contract shapes", () => {
  it("ApiErrorShape carries an error string", () => {
    const shape: ApiErrorShape = { error: "boom" };
    expect(shape.error).toBe("boom");
  });
  it("ProviderId covers all six providers", () => {
    const ids: ProviderId[] = ["moviebox", "fourkhdhub", "bdix_circleftp", "bdix_dhakaflix", "addons", "anime"];
    expect(new Set(ids).size).toBe(6);
  });
  it("CatalogItem round-trips provider, title, type, year, poster", () => {
    const item: CatalogItem = {
      id: { provider: "moviebox", value: "v1" },
      title: "日本語 🎬",
      media_type: "anime",
      year: "2024",
      poster_url: null,
      season_count: 2,
    };
    expect(item.id.value).toBe("v1");
    expect(item.media_type).toBe("anime");
    expect(item.poster_url).toBeNull();
  });
  it("BrowseMetrics tolerates all-null values", () => {
    const m: BrowseMetrics = { trending: null, rating: null, recent_rating: null, popularity: null };
    expect(Object.values(m)).toEqual([null, null, null, null]);
  });
  it("BrowseMetrics tolerates an empty object", () => {
    const m: BrowseMetrics = {};
    expect(m.trending).toBeUndefined();
  });
  it("HomeResponse nests items and per-id metrics", () => {
    const res: HomeResponse = { tab: "2", page: 1, items: [], metrics: { v1: { trending: 3 } } };
    expect(res.page).toBe(1);
    expect(res.metrics.v1.trending).toBe(3);
  });
  it("SearchResponse echoes provider, query, and page", () => {
    const res: SearchResponse = { provider: "moviebox", query: "q", page: 2, items: [] };
    expect(res.query).toBe("q");
    expect(res.page).toBe(2);
  });
  it("DetailsResponse nests full media details", () => {
    const res: DetailsResponse = {
      provider: "moviebox",
      id: "x",
      details: {
        id: { provider: "moviebox", value: "x" },
        title: "T",
        media_type: "movie",
        year: null,
        description: null,
        tagline: null,
        imdb_rating: null,
        director: null,
        stars: null,
        prints: null,
        audios: null,
        poster_url: null,
        duration: null,
        genres: [],
        seasons: [],
        dubs: [],
      },
    };
    expect(res.details.genres).toEqual([]);
  });
  it("StreamsResponse carries releases with mirrors", () => {
    const res: StreamsResponse = {
      provider: "moviebox",
      id: "x",
      season: 0,
      episode: 0,
      releases: [
        {
          provider: "moviebox",
          filename: "f.mkv",
          quality: "1080p",
          codec: null,
          language: null,
          size_bytes: 123,
          season: null,
          episode: null,
          mirrors: [{ label: "m", resolver_url: "https://r", headers: [], direct_file: true }],
          resource_id: null,
        },
      ],
    };
    expect(res.releases[0].mirrors).toHaveLength(1);
  });
  it("PlayResponse flags header requirements and the play URL", () => {
    const res: PlayResponse = {
      provider: "moviebox",
      id: "x",
      season: 1,
      episode: 2,
      release: {
        provider: "moviebox",
        filename: "f",
        quality: null,
        codec: null,
        language: null,
        size_bytes: null,
        season: 1,
        episode: 2,
        mirrors: [],
        resource_id: null,
      },
      mirror_label: "m",
      direct_file: false,
      requires_headers: true,
      play_url: "https://play/x",
    };
    expect(res.requires_headers).toBe(true);
  });
  it("TranscodeStartResponse and CaptionsResponse pair ids with payloads", () => {
    const t: TranscodeStartResponse = { session: "s", m3u8_url: "/api/x.m3u8" };
    const c: CaptionsResponse = { id: "x", subtitles: [{ name: "en", url: "https://s/en.vtt" }] };
    expect(t.session).toBe("s");
    expect(c.subtitles).toHaveLength(1);
  });
  it("HealthResponse lists provider capabilities", () => {
    const h: HealthResponse = {
      ok: true,
      service: "mb",
      version: "1.0",
      providers: [
        {
          key: "moviebox",
          label: "MovieBox",
          capabilities: {
            supports_search: true,
            supports_pagination: true,
            supports_series: true,
            supports_subtitles: false,
            supports_homepage: true,
          },
        },
      ],
    };
    expect(h.providers[0].capabilities.supports_search).toBe(true);
  });
});
