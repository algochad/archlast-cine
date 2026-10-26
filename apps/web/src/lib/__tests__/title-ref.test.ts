import { describe, it, expect } from "vitest";
import { decodeTitleRef, encodeTitleRef, titleHref, watchHref } from "@/lib/title-ref";

describe("encodeTitleRef / decodeTitleRef", () => {
  it("round-trips every id shape the backend emits", () => {
    const cases: [Parameters<typeof encodeTitleRef>[0], string][] = [
      ["collaps", "tt1375666"],
      ["collaps", "tt0944947"],
      ["moviebox", "977486567826752424"],
      ["anime", "9NdrgcZjsp7HEJ5oK"],
      ["fourkhdhub", "/inception-movie-509/"],
      ["fourkhdhub", "/weird path/with spaces/"],
      ["bdix_circleftp", "folder/💥/file name.mkv"],
      ["addons", "a:b:c"],
      ["moviebox", "has space"],
    ];
    for (const [provider, id] of cases) {
      const ref = encodeTitleRef(provider, id);
      expect(decodeTitleRef(ref)).toEqual({ provider, id });
    }
  });

  it("never leaks a provider name into the ref", () => {
    for (const [p, id] of [
      ["collaps", "tt1375666"],
      ["moviebox", "123"],
      ["fourkhdhub", "/a-b/"],
      ["anime", "abc"],
      ["bdix_dhakaflix", "x/y"],
    ] as const) {
      const ref = encodeTitleRef(p, id);
      expect(ref).not.toMatch(/collaps|moviebox|fourkhdhub|anime|bdix|addons/i);
    }
  });

  it("is URL-path safe", () => {
    for (const id of ["a b/c?d#e%f", "日本語", "..", "/x/"]) {
      const ref = encodeTitleRef("addons", id);
      expect(ref).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeTitleRef(ref)).toEqual({ provider: "addons", id });
    }
  });

  it("rejects malformed and hostile refs", () => {
    for (const bad of [
      "",
      "tt",
      "tt12",
      "m-",
      "m-has space",
      "m-../../etc",
      "k-/etc/passwd",
      "z-abc",
      "x-",
      "x-%%%",
      "x-" + btoa("not json").replace(/=+$/, ""),
      "x-" + btoa(JSON.stringify(["nope", "id"])).replace(/=+$/, ""),
      "x-" + btoa(JSON.stringify(["anime", ""])).replace(/=+$/, ""),
      "%E0%A4%A",
      "ttabc",
    ]) {
      expect(decodeTitleRef(bad)).toBeNull();
    }
  });

  it("decodes percent-encoded refs", () => {
    expect(decodeTitleRef(encodeURIComponent("m-123"))).toEqual({ provider: "moviebox", id: "123" });
  });
});

describe("titleHref / watchHref", () => {
  it("build clean, provider-free paths", () => {
    expect(titleHref("collaps", "tt1375666")).toBe("/title/tt1375666");
    expect(watchHref("collaps", "tt0944947", { season: 3, episode: 5 })).toBe("/watch/tt0944947?s=3&e=5");
    expect(watchHref("anime", "abc", { season: 1, episode: 2 })).toBe("/watch/a-abc?s=1&e=2");
    expect(watchHref("moviebox", "42")).toBe("/watch/m-42");
    expect(watchHref("moviebox", "42", null)).toBe("/watch/m-42");
  });
});
