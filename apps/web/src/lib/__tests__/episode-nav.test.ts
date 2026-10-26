import { describe, it, expect } from "vitest";
import { prevEpisode, nextEpisode } from "@/lib/episode-nav";
import type { Season, Episode } from "@/lib/types";

function makeSeasons(overrides: Partial<Season>[]): Season[] {
  if (overrides.length === 0) {
    return [1, 2, 3].map((n) => ({
      number: n,
      episodes: [
        { season: n, number: 1, title: "Ep 1" },
        { season: n, number: 2, title: "Ep 2" },
        { season: n, number: 3, title: "Ep 3" },
      ],
    }));
  }
  return overrides.map((o, i) => ({
    number: i + 1,
    episodes: [
      { season: i + 1, number: 1, title: "Ep 1" },
      { season: i + 1, number: 2, title: "Ep 2" },
      { season: i + 1, number: 3, title: "Ep 3" },
    ],
    ...o,
  }));
}

describe("prevEpisode", () => {
  it("returns previous episode in same season", () => {
    const seasons = makeSeasons([]);
    expect(prevEpisode(seasons, 1, 2)).toEqual({ season: 1, episode: 1 });
    expect(prevEpisode(seasons, 1, 3)).toEqual({ season: 1, episode: 2 });
  });

  it("returns last episode of previous season when at first episode", () => {
    const seasons = makeSeasons([]);
    expect(prevEpisode(seasons, 2, 1)).toEqual({ season: 1, episode: 3 });
  });

  it("skips missing season numbers (prefer s-1, fallback nearest lower)", () => {
    const seasons = [
      { number: 1, episodes: [{ season: 1, number: 1, title: "Ep 1" }] },
      { number: 3, episodes: [{ season: 3, number: 1, title: "Ep 1" }] },
      { number: 5, episodes: [{ season: 5, number: 1, title: "Ep 1" }] },
    ];
    expect(prevEpisode(seasons, 5, 1)).toEqual({ season: 3, episode: 1 });
  });

  it("returns null at bounds (season 1, episode 1)", () => {
    const seasons = makeSeasons([]);
    expect(prevEpisode(seasons, 1, 1)).toBeNull();
  });

  it("returns null for unknown season", () => {
    const seasons = makeSeasons([]);
    expect(prevEpisode(seasons, 99, 1)).toBeNull();
  });

  it("returns null for unknown episode", () => {
    const seasons = makeSeasons([]);
    expect(prevEpisode(seasons, 1, 99)).toBeNull();
  });

  it("handles empty seasons array", () => {
    expect(prevEpisode([], 1, 1)).toBeNull();
  });

  it("handles season with zero episodes", () => {
    const seasons = [
      { number: 1, episodes: [] },
      { number: 2, episodes: [{ season: 2, number: 1, title: "Ep 1" }] },
    ];
    expect(prevEpisode(seasons, 2, 1)).toBeNull();
  });
});

describe("nextEpisode", () => {
  it("returns next episode in same season", () => {
    const seasons = makeSeasons([]);
    expect(nextEpisode(seasons, 1, 1)).toEqual({ season: 1, episode: 2 });
    expect(nextEpisode(seasons, 1, 2)).toEqual({ season: 1, episode: 3 });
  });

  it("returns first episode of next season when at last episode", () => {
    const seasons = makeSeasons([]);
    expect(nextEpisode(seasons, 1, 3)).toEqual({ season: 2, episode: 1 });
  });

  it("skips missing season numbers (prefer s+1, fallback nearest higher)", () => {
    const seasons = [
      { number: 1, episodes: [{ season: 1, number: 1, title: "Ep 1" }] },
      { number: 3, episodes: [{ season: 3, number: 1, title: "Ep 1" }] },
      { number: 5, episodes: [{ season: 5, number: 1, title: "Ep 1" }] },
    ];
    expect(nextEpisode(seasons, 1, 1)).toEqual({ season: 3, episode: 1 });
  });

  it("returns null at bounds (last episode of last season)", () => {
    const seasons = makeSeasons([]);
    expect(nextEpisode(seasons, 3, 3)).toBeNull();
  });

  it("returns null for unknown season", () => {
    const seasons = makeSeasons([]);
    expect(nextEpisode(seasons, 99, 1)).toBeNull();
  });

  it("returns null for unknown episode", () => {
    const seasons = makeSeasons([]);
    expect(nextEpisode(seasons, 1, 99)).toBeNull();
  });

  it("handles empty seasons array", () => {
    expect(nextEpisode([], 1, 1)).toBeNull();
  });

  it("handles season with zero episodes", () => {
    const seasons = [
      { number: 1, episodes: [{ season: 1, number: 1, title: "Ep 1" }] },
      { number: 2, episodes: [] },
      { number: 3, episodes: [{ season: 3, number: 1, title: "Ep 1" }] },
    ];
    expect(nextEpisode(seasons, 1, 1)).toEqual({ season: 3, episode: 1 });
  });
});