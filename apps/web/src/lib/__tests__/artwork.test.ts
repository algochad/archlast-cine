import { describe, it, expect } from "vitest";
import { backdropUrl, episodeStillUrl, logoUrl, posterUrl } from "@/lib/artwork";

describe("artwork urls", () => {
  it("derive from IMDb ids of the catalog source only", () => {
    expect(backdropUrl("collaps", "tt1375666")).toBe("https://images.metahub.space/background/medium/tt1375666/img");
    expect(logoUrl("collaps", "tt1375666")).toBe("https://images.metahub.space/logo/medium/tt1375666/img");
    expect(posterUrl("collaps", "tt1375666")).toBe("https://images.metahub.space/poster/medium/tt1375666/img");
    expect(backdropUrl("moviebox", "123")).toBeNull();
    expect(backdropUrl("collaps", "not-an-id")).toBeNull();
    expect(backdropUrl("collaps", "tt1375666/../x")).toBeNull();
  });

  it("builds episode stills and refuses nonsense", () => {
    expect(episodeStillUrl("collaps", "tt0944947", 3, 5)).toBe("https://episodes.metahub.space/tt0944947/3/5/w780.jpg");
    expect(episodeStillUrl("collaps", "tt0944947", 0, 1)).toBe("https://episodes.metahub.space/tt0944947/0/1/w780.jpg");
    expect(episodeStillUrl("collaps", "tt0944947", 1, 0)).toBeNull();
    expect(episodeStillUrl("collaps", "tt0944947", 1.5, 1)).toBeNull();
    expect(episodeStillUrl("collaps", "tt0944947", -1, 1)).toBeNull();
    expect(episodeStillUrl("anime", "x", 1, 1)).toBeNull();
  });
});
