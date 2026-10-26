import { describe, it, expect } from "vitest";
import {
  DEFAULT_SUB_STYLE,
  MEDIA_TYPES,
  PROVIDER_IDS,
  REGION_IDS,
  isMediaType,
  isProviderId,
  isRegionId,
} from "./account";

describe("id guards", () => {
  it("accept every declared id and reject everything else", () => {
    for (const id of REGION_IDS) expect(isRegionId(id)).toBe(true);
    for (const id of PROVIDER_IDS) expect(isProviderId(id)).toBe(true);
    for (const id of MEDIA_TYPES) expect(isMediaType(id)).toBe(true);
    for (const bad of ["", "PH", "eu", " ph", "ph ", "toString", "__proto__"]) {
      expect(isRegionId(bad)).toBe(false);
    }
    for (const bad of ["", "anime", "MovieBox", "constructor"]) expect(isProviderId(bad)).toBe(false);
    for (const bad of ["", "film", "Movie"]) expect(isMediaType(bad)).toBe(false);
  });
});

describe("DEFAULT_SUB_STYLE", () => {
  it("is a sane readable default", () => {
    expect(DEFAULT_SUB_STYLE.scale).toBe(1);
    expect(DEFAULT_SUB_STYLE.bgOpacity).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_SUB_STYLE.bgOpacity).toBeLessThanOrEqual(1);
  });
});
