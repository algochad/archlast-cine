import { describe, it, expect } from "vitest";
import type {
  MediaType,
  ProviderSource,
  AnimeSeason,
  AnimeStatus,
  AnimeRelationType,
  AnimeRelation,
  AnimeMetadata,
  Media,
  Episode,
  StreamFormat,
  Subtitle,
  Stream,
} from "../media-types";

// media-types.ts exports types only (no runtime functions): each suite below
// constructs every exported shape so a drifted unified media model fails at
// typecheck time, plus a runtime invariant per sample.

describe("MediaType", () => {
  it("covers movie, series, and anime", () => {
    const all: MediaType[] = ["movie", "series", "anime"];
    expect(new Set(all).size).toBe(3);
  });
  it("rejects unknown classifications at the value level", () => {
    const valid: MediaType[] = ["movie", "series", "anime"];
    for (const v of ["film", "tv", "", "MOVIE", "アニメ"]) expect(valid).not.toContain(v);
  });
  it("discriminates Media records", () => {
    const m: Media = { id: "1", type: "anime", provider: "moviebox", title: "T" };
    expect(m.type).toBe("anime");
  });
  it("round-trips through JSON untouched", () => {
    const t: MediaType = "series";
    expect(JSON.parse(JSON.stringify(t))).toBe("series");
  });
  it("stays a plain string (no Date/Map/class instances)", () => {
    const t: MediaType = "movie";
    expect(typeof t).toBe("string");
  });
});

describe("ProviderSource", () => {
  it("covers the five known providers", () => {
    const all: ProviderSource[] = ["moviebox", "fourkhdhub", "bdix_circleftp", "bdix_dhakaflix", "addons"];
    expect(new Set(all).size).toBe(5);
  });
  it("excludes unknown provider keys", () => {
    const valid: ProviderSource[] = ["moviebox", "fourkhdhub", "bdix_circleftp", "bdix_dhakaflix", "addons"];
    for (const v of ["anime", "", "MovieBox", "netflix"]) expect(valid).not.toContain(v);
  });
  it("tags Media records", () => {
    const m: Media = { id: "1", type: "movie", provider: "fourkhdhub", title: "T" };
    expect(m.provider).toBe("fourkhdhub");
  });
  it("round-trips through JSON untouched", () => {
    const p: ProviderSource = "bdix_dhakaflix";
    expect(JSON.parse(JSON.stringify(p))).toBe("bdix_dhakaflix");
  });
  it("stays a plain string", () => {
    const p: ProviderSource = "addons";
    expect(typeof p).toBe("string");
  });
});

describe("AnimeSeason / AnimeStatus / AnimeRelationType", () => {
  it("covers the four broadcast seasons", () => {
    const all: AnimeSeason[] = ["winter", "spring", "summer", "fall"];
    expect(new Set(all).size).toBe(4);
  });
  it("covers the five airing statuses", () => {
    const all: AnimeStatus[] = ["releasing", "finished", "not_yet_released", "cancelled", "hiatus"];
    expect(new Set(all).size).toBe(5);
  });
  it("covers all eleven relation types", () => {
    const all: AnimeRelationType[] = [
      "prequel",
      "sequel",
      "parent",
      "side_story",
      "spin_off",
      "adaptation",
      "summary",
      "character",
      "source",
      "alternative",
      "other",
    ];
    expect(new Set(all).size).toBe(11);
  });
  it("keeps season values lowercase AniList convention", () => {
    const s: AnimeSeason = "fall";
    expect(s).toBe(s.toLowerCase());
  });
  it("keeps status values lowercase with underscores", () => {
    const s: AnimeStatus = "not_yet_released";
    expect(s).toMatch(/^[a-z_]+$/);
  });
});

describe("AnimeRelation", () => {
  it("constructs a minimal relation with type and title", () => {
    const r: AnimeRelation = { type: "sequel", title: "Second Season" };
    expect(r.title).toBe("Second Season");
  });
  it("carries optional AniList and MAL ids", () => {
    const r: AnimeRelation = { type: "prequel", anilistId: 1, malId: 2, title: "First" };
    expect(r.anilistId).toBe(1);
    expect(r.malId).toBe(2);
  });
  it("accepts unicode titles", () => {
    const r: AnimeRelation = { type: "alternative", title: "日本語 🎬" };
    expect(r.title).toBe("日本語 🎬");
  });
  it("round-trips through JSON untouched", () => {
    const r: AnimeRelation = { type: "spin_off", anilistId: 5, title: "Spin" };
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it("supports every relation type as a discriminator", () => {
    const types: AnimeRelationType[] = ["prequel", "sequel", "parent", "side_story", "other"];
    for (const type of types) {
      const r: AnimeRelation = { type, title: "t" };
      expect(r.type).toBe(type);
    }
  });
});

describe("AnimeMetadata", () => {
  it("constructs an empty block (everything optional)", () => {
    const m: AnimeMetadata = {};
    expect(Object.keys(m)).toHaveLength(0);
  });
  it("carries studios, season, episode count, and status", () => {
    const m: AnimeMetadata = {
      anilistId: 21,
      malId: 20,
      studios: ["Studio Ghibli"],
      season: "spring",
      episodeCount: 26,
      status: "finished",
    };
    expect(m.studios).toEqual(["Studio Ghibli"]);
    expect(m.episodeCount).toBe(26);
  });
  it("allows an unknown episode count as null or absent", () => {
    const a: AnimeMetadata = { episodeCount: null };
    const b: AnimeMetadata = {};
    expect(a.episodeCount).toBeNull();
    expect(b.episodeCount).toBeUndefined();
  });
  it("nests relations", () => {
    const m: AnimeMetadata = { relations: [{ type: "sequel", title: "S2" }] };
    expect(m.relations).toHaveLength(1);
  });
  it("round-trips through JSON untouched", () => {
    const m: AnimeMetadata = { anilistId: 1, season: "winter", status: "releasing" };
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe("Media", () => {
  it("constructs a minimal movie record", () => {
    const m: Media = { id: "1", type: "movie", provider: "moviebox", title: "Film" };
    expect(m.title).toBe("Film");
    expect(m.animeMetadata).toBeUndefined();
  });
  it("keeps movie/series records free of anime metadata", () => {
    const m: Media = { id: "1", type: "series", provider: "moviebox", title: "Show" };
    expect("animeMetadata" in m).toBe(false);
  });
  it("attaches anime metadata only for anime", () => {
    const m: Media = {
      id: "a1",
      type: "anime",
      provider: "moviebox",
      title: "アニメ 🎬",
      year: 2024,
      genres: ["Action"],
      animeMetadata: { status: "releasing" },
    };
    expect(m.animeMetadata?.status).toBe("releasing");
  });
  it("accepts null poster/backdrop/description/year", () => {
    const m: Media = {
      id: "1",
      type: "movie",
      provider: "addons",
      title: "T",
      poster: null,
      backdrop: null,
      description: null,
      year: null,
    };
    expect(m.poster).toBeNull();
    expect(m.year).toBeNull();
  });
  it("round-trips a full record through JSON untouched", () => {
    const m: Media = { id: "1", type: "movie", provider: "moviebox", title: "T 日本", genres: ["Drama"] };
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe("Episode", () => {
  it("constructs a series episode with a season", () => {
    const e: Episode = { id: "e1", mediaId: "m1", season: 2, number: 7, title: "Ep" };
    expect(e.season).toBe(2);
    expect(e.number).toBe(7);
  });
  it("omits season for flat-numbered anime", () => {
    const e: Episode = { id: "e1", mediaId: "a1", number: 42 };
    expect(e.season).toBeUndefined();
  });
  it("accepts null title/description/thumbnail", () => {
    const e: Episode = { id: "e", mediaId: "m", number: 1, title: null, description: null, thumbnail: null };
    expect(e.title).toBeNull();
  });
  it("accepts unicode titles", () => {
    const e: Episode = { id: "e", mediaId: "m", number: 1, title: "日本語 🎬" };
    expect(e.title).toBe("日本語 🎬");
  });
  it("round-trips through JSON untouched", () => {
    const e: Episode = { id: "e", mediaId: "m", season: 1, number: 1 };
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });
});

describe("StreamFormat / Subtitle / Stream", () => {
  it("covers hls, dash, and mp4", () => {
    const all: StreamFormat[] = ["hls", "dash", "mp4"];
    expect(new Set(all).size).toBe(3);
  });
  it("excludes non-player containers", () => {
    const valid: StreamFormat[] = ["hls", "dash", "mp4"];
    for (const v of ["mkv", "webm", "", "HLS"]) expect(valid).not.toContain(v);
  });
  it("constructs a subtitle with optional label", () => {
    const withLabel: Subtitle = { language: "en", url: "https://s/en.vtt", label: "English (SDH)" };
    const bare: Subtitle = { language: "ja", url: "https://s/ja.vtt" };
    expect(withLabel.label).toBe("English (SDH)");
    expect(bare.label).toBeUndefined();
  });
  it("constructs a minimal playable stream", () => {
    const s: Stream = { id: "s1", url: "https://cdn/x.m3u8", format: "hls" };
    expect(s.quality).toBeUndefined();
    expect(s.subtitles).toBeUndefined();
  });
  it("carries quality and subtitle tracks when present", () => {
    const s: Stream = {
      id: "s1",
      url: "https://cdn/x.mpd",
      quality: "1080p",
      format: "dash",
      subtitles: [{ language: "en", url: "https://s/en.vtt" }],
    };
    expect(s.subtitles).toHaveLength(1);
  });
  it("round-trips a full stream through JSON untouched", () => {
    const s: Stream = { id: "s", url: "https://c/v.mp4", quality: null, format: "mp4" };
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
