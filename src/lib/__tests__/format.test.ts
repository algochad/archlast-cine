import { describe, it, expect } from "vitest";
import { formatBytes, formatRuntime, formatClock, cleanFilename } from "../format";

describe("formatBytes", () => {
  it("returns null for null", () => expect(formatBytes(null)).toBeNull());
  it("returns null for undefined", () => expect(formatBytes(undefined)).toBeNull());
  it("returns null for zero", () => expect(formatBytes(0)).toBeNull());
  it("returns null for negative values", () => {
    expect(formatBytes(-1)).toBeNull();
    expect(formatBytes(-1024)).toBeNull();
  });
  it("formats bare bytes with one decimal below 100 and rounded at/above 100", () => {
    expect(formatBytes(1)).toBe("1.0 B");
    expect(formatBytes(999)).toBe("999 B");
  });
  it("rolls over at the 1024 boundary", () => {
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
  });
  it("formats fractional kilobytes", () => expect(formatBytes(1536)).toBe("1.5 KB"));
  it("formats megabytes", () => expect(formatBytes(1048576)).toBe("1.0 MB"));
  it("formats gigabytes", () => expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB"));
  it("caps at terabytes for huge values", () => {
    expect(formatBytes(3 * 1024 ** 4)).toBe("3.0 TB");
    expect(formatBytes(Number.MAX_SAFE_INTEGER)).toContain("TB");
  });
});

describe("formatRuntime", () => {
  it("returns null for null/undefined/empty", () => {
    expect(formatRuntime(null)).toBeNull();
    expect(formatRuntime(undefined)).toBeNull();
    expect(formatRuntime("")).toBeNull();
  });
  it("formats hours and minutes", () => expect(formatRuntime("PT2H28M")).toBe("2h 28m"));
  it("formats minutes only", () => expect(formatRuntime("PT45M")).toBe("45m"));
  it("rounds leftover seconds up into the minute label", () =>
    expect(formatRuntime("PT2H28M7.9S")).toBe("2h 28m"));
  it("returns null for zero-length ISO durations", () => {
    expect(formatRuntime("PT0S")).toBeNull();
    expect(formatRuntime("PT")).toBeNull();
  });
  it("formats plain minute strings", () => {
    expect(formatRuntime("45")).toBe("45m");
    expect(formatRuntime("90")).toBe("1h 30m");
  });
  it("handles seconds-only ISO durations", () =>
    expect(formatRuntime("PT90S")).toBe("0m"));
  it("returns garbage strings untouched", () => {
    expect(formatRuntime("hello")).toBe("hello");
    expect(formatRuntime("日本語")).toBe("日本語");
  });
  it("handles hours-only ISO durations", () =>
    expect(formatRuntime("PT2H")).toBe("2h 0m"));
});

describe("formatClock", () => {
  it("formats zero", () => expect(formatClock(0)).toBe("0:00"));
  it("pads single-digit seconds", () => expect(formatClock(5)).toBe("0:05"));
  it("formats minutes and seconds", () => expect(formatClock(65)).toBe("1:05"));
  it("floors fractional seconds", () => expect(formatClock(59.9)).toBe("0:59"));
  it("clamps negative input to zero", () => expect(formatClock(-1)).toBe("0:00"));
  it("clamps NaN to zero", () => expect(formatClock(NaN)).toBe("0:00"));
  it("clamps Infinity to zero", () => {
    expect(formatClock(Infinity)).toBe("0:00");
    expect(formatClock(-Infinity)).toBe("0:00");
  });
  it("switches to h:mm:ss at one hour", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3661)).toBe("1:01:01");
  });
  it("pads minutes inside hour form", () => expect(formatClock(3723.9)).toBe("1:02:03"));
  it("handles long runtimes", () => expect(formatClock(86399)).toBe("23:59:59"));
});

describe("cleanFilename", () => {
  it("strips a trailing mp4 extension", () =>
    expect(cleanFilename("movie.mp4")).toBe("movie"));
  it("strips extensions case-insensitively", () =>
    expect(cleanFilename("FILM.MKV")).toBe("FILM"));
  it("strips all supported container extensions", () => {
    for (const ext of ["mp4", "mkv", "webm", "avi", "m4v"])
      expect(cleanFilename(`clip.${ext}`)).toBe("clip");
  });
  it("turns dots and underscores into spaces", () =>
    expect(cleanFilename("the.movie_2024.mkv")).toBe("the movie 2024"));
  it("collapses repeated separators and trims", () =>
    expect(cleanFilename("a___b...c.mp4")).toBe("a b c"));
  it("leaves extensionless names with separators cleaned", () =>
    expect(cleanFilename("noext")).toBe("noext"));
  it("does not strip non-final extensions", () =>
    expect(cleanFilename("my.movie.mp4.bak")).toBe("my movie mp4 bak"));
  it("trims surrounding whitespace", () =>
    expect(cleanFilename("  spaced   ")).toBe("spaced"));
  it("preserves unicode titles", () =>
    expect(cleanFilename("日本語_映画🎬.mkv")).toBe("日本語 映画🎬"));
  it("handles empty input", () => expect(cleanFilename("")).toBe(""));
});
