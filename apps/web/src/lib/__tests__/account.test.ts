import { describe, it, expect } from "vitest";
import { REGION_IDS } from "../account";
import type { AccountSettings, AccountState, AccountUser, MyListItem, RegionId, WatchEntry } from "../account";

describe("REGION_IDS", () => {
  it("lists the four supported regions in order", () =>
    expect(REGION_IDS).toEqual(["ph", "us", "in", "sg"]));
  it("keeps ids unique", () =>
    expect(new Set(REGION_IDS).size).toBe(REGION_IDS.length));
  it("includes every RegionId member", () => {
    const all: RegionId[] = ["ph", "us", "in", "sg"];
    for (const r of all) expect(REGION_IDS).toContain(r);
  });
  it("excludes unknown region codes", () => {
    expect(REGION_IDS).not.toContain("eu");
    expect(REGION_IDS).not.toContain("");
    expect(REGION_IDS).not.toContain("US");
  });
  it("is frozen-length stable across reads", () =>
    expect(REGION_IDS).toHaveLength(4));
});

// Compile-time contract checks: these construct every exported shape so a
// drifted backend contract fails the suite at typecheck time; each block
// also asserts a runtime invariant about the sample values.
describe("account domain shapes", () => {
  it("AccountUser carries id, email, name, and createdAt", () => {
    const user: AccountUser = { id: 7, email: "a@example.com", name: "Ada", createdAt: "2024-01-01" };
    expect(user.id).toBe(7);
    expect(user.email).toContain("@");
    expect(user.name).toBe("Ada");
    expect(user.createdAt).toBe("2024-01-01");
  });
  it("AccountSettings pairs a region with a provider", () => {
    const settings: AccountSettings = { region: "ph", provider: "moviebox" };
    expect(REGION_IDS).toContain(settings.region);
    expect(settings.provider).toBe("moviebox");
  });
  it("AccountState nests user and settings", () => {
    const state: AccountState = {
      user: { id: 1, email: "a@example.com", name: "A", createdAt: "2024-01-01" },
      settings: { region: "sg", provider: "fourkhdhub" },
    };
    expect(state.user.id).toBe(1);
    expect(state.settings.region).toBe("sg");
  });
  it("WatchEntry tracks position, duration, season, episode, and updatedAt", () => {
    const entry: WatchEntry = {
      provider: "moviebox",
      id: "x",
      title: "T",
      poster: null,
      mediaType: "anime",
      year: "2024",
      season: 2,
      episode: 7,
      position: 42.5,
      duration: 1500,
      updatedAt: 123456,
    };
    expect(entry.position).toBeLessThanOrEqual(entry.duration);
    expect(entry.season).toBe(2);
    expect(entry.episode).toBe(7);
    expect(entry.updatedAt).toBe(123456);
  });
  it("WatchEntry accepts all three media types", () => {
    const types: WatchEntry["mediaType"][] = ["movie", "series", "anime"];
    for (const mediaType of types) {
      const entry: WatchEntry = {
        provider: "p",
        id: "i",
        title: "t",
        poster: null,
        mediaType,
        year: null,
        season: 0,
        episode: 0,
        position: 0,
        duration: 0,
        updatedAt: 0,
      };
      expect(entry.mediaType).toBe(mediaType);
    }
  });
  it("WatchEntry allows a null poster and year", () => {
    const entry: WatchEntry = {
      provider: "p",
      id: "i",
      title: "日本語 🎬",
      poster: null,
      mediaType: "movie",
      year: null,
      season: 0,
      episode: 0,
      position: 0,
      duration: 0,
      updatedAt: 0,
    };
    expect(entry.poster).toBeNull();
    expect(entry.year).toBeNull();
  });
  it("MyListItem carries provider, id, title, poster, mediaType, year, addedAt", () => {
    const item: MyListItem = {
      provider: "moviebox",
      id: "m1",
      title: "T",
      poster: "https://img/x.jpg",
      mediaType: "series",
      year: "2023",
      addedAt: 999,
    };
    expect(item.addedAt).toBe(999);
    expect(item.poster).toContain("https://");
  });
});
