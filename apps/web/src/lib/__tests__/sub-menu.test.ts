import { describe, it, expect } from "vitest";
import { groupSubtitles, pickAutoSubtitle, subtitleLanguage } from "@/lib/sub-menu";
import type { SubtitleOption } from "@/lib/types";

const sub = (over: Partial<SubtitleOption> & { url: string }): SubtitleOption => ({ name: "Track", ...over });

describe("subtitleLanguage", () => {
  it("normalizes codes, regional tags and names", () => {
    expect(subtitleLanguage({ language: "en", name: "x" })).toBe("en");
    expect(subtitleLanguage({ language: "pt-BR", name: "x" })).toBe("pt");
    expect(subtitleLanguage({ language: "eng", name: "x" })).toBe("en");
    expect(subtitleLanguage({ language: undefined, name: "English" })).toBe("en");
    expect(subtitleLanguage({ language: "", name: "???" })).toBe("");
  });
});

describe("groupSubtitles", () => {
  const opts = [
    sub({ url: "1", language: "es", name: "Spanish" }),
    sub({ url: "2", language: "en", name: "English" }),
    sub({ url: "3", language: "en", name: "English (SDH)", sdh: true }),
    sub({ url: "4", language: "ja", name: "Japanese" }),
    sub({ url: "5", language: "en", name: "English 2" }),
    sub({ url: "6", language: "pt-BR", name: "Portuguese" }),
    sub({ url: "7", name: "mystery.srt" }),
    sub({ url: "8", language: "en", name: "English (Forced)", forced: true }),
  ];

  it("puts preferred languages first, then English, then A-Z, unknown last", () => {
    const groups = groupSubtitles(opts, ["ja"]);
    expect(groups.map((g) => g.code)).toEqual(["ja", "en", "pt", "es", "und"]);
    expect(groups[0].preferred).toBe(true);
    expect(groups[1].preferred).toBe(false);
  });

  it("orders tracks full → SDH → forced and numbers repeats", () => {
    const en = groupSubtitles(opts, ["en"])[0];
    expect(en.tracks.map((t) => t.label)).toEqual(["Standard", "Standard · 2", "SDH", "Forced"]);
  });

  it("labels regional variants and unknown languages", () => {
    const groups = groupSubtitles(opts, []);
    expect(groups.find((g) => g.code === "pt")!.tracks[0].label).toBe("Standard (BR)");
    expect(groups.find((g) => g.code === "und")!.label).toBe("Other");
    expect(groups.find((g) => g.code === "es")!.label).toBe("Spanish");
  });

  it("handles empty input and keeps every track exactly once", () => {
    expect(groupSubtitles([], ["en"])).toEqual([]);
    const total = groupSubtitles(opts, ["en"]).reduce((n, g) => n + g.tracks.length, 0);
    expect(total).toBe(opts.length);
  });
});

describe("pickAutoSubtitle", () => {
  const list = [
    sub({ url: "sl", language: "sl", name: "Slovenian" }),
    sub({ url: "hy", language: "hy", name: "Armenian" }),
    sub({ url: "en-f", language: "en", name: "English (Forced)", forced: true }),
    sub({ url: "en-sdh", language: "en", name: "English (SDH)", sdh: true }),
    sub({ url: "en", language: "en", name: "English" }),
    sub({ url: "ru", language: "ru", name: "Russian" }),
  ];

  it("is null for an empty list", () => {
    expect(pickAutoSubtitle([], { langs: ["en"] })).toBeNull();
  });

  it("picks the full English track — never Slovenian/Armenian via name substring", () => {
    expect(pickAutoSubtitle(list, { langs: ["en"] })?.url).toBe("en");
  });

  it("prefers SDH only when asked", () => {
    expect(pickAutoSubtitle(list, { langs: ["en"], preferSDH: true })?.url).toBe("en-sdh");
  });

  it("walks the preference list, then falls back to English", () => {
    expect(pickAutoSubtitle(list, { langs: ["ru", "en"] })?.url).toBe("ru");
    expect(pickAutoSubtitle(list, { langs: ["ja", "ko"] })?.url).toBe("en");
  });

  it("uses a forced track only when it is the language's only option", () => {
    const only = [sub({ url: "f", language: "en", forced: true }), sub({ url: "de", language: "de" })];
    expect(pickAutoSubtitle(only, { langs: ["en"] })?.url).toBe("f");
  });

  it("falls back to the first full track when nothing else matches", () => {
    const odd = [sub({ url: "a", language: "fi" }), sub({ url: "b", language: "sv" })];
    expect(pickAutoSubtitle(odd, { langs: ["ja"] })?.url).toBe("a");
  });
});

describe("group labels for languages the UI table lacks", () => {
  it("uses the track's own plain language name", () => {
    const groups = groupSubtitles(
      [sub({ url: "1", language: "xx", name: "Klingon 2" }), sub({ url: "2", language: "xx", name: "Klingon (SDH)", sdh: true })],
      [],
    );
    expect(groups[0].label).toBe("Klingon");
  });

  it("knows common languages without needing the track name", () => {
    expect(groupSubtitles([sub({ url: "1", language: "bg", name: "Bulgarian" })], [])[0].label).toBe("Bulgarian");
    expect(groupSubtitles([sub({ url: "1", language: "cs", name: "x.srt" })], [])[0].label).toBe("Czech");
  });

  it("falls back to the upper-cased code for opaque names", () => {
    expect(groupSubtitles([sub({ url: "1", language: "qq", name: "weird 1080p.v2" })], [])[0].label).toBe("QQ");
  });
});
