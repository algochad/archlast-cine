import { describe, it, expect } from "vitest";
import { normalizeLang, parseHlsAudioRenditions, pickAudioTrack } from "@/lib/audio-tracks";

const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="rus0",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="ru",URI="/api/proxy/t/f/a1"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="ukr6",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE="uk",URI="/api/proxy/t/f/a7"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="eng8",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE="en",URI="/api/proxy/t/f/a9"',
  "",
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="failover-audio-0",NAME="rus0",DEFAULT=YES,LANGUAGE="ru",URI="/api/proxy/t/f/b1"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="failover-audio-0",NAME="eng8",DEFAULT=NO,LANGUAGE="en",URI="/api/proxy/t/f/b9"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="/s.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=1131113,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720,AUDIO="audio0"',
  "/api/proxy/t/f/v1",
].join("\r\n");

describe("parseHlsAudioRenditions", () => {
  it("lists the first audio group in order, skipping failover copies and subtitles", () => {
    expect(parseHlsAudioRenditions(MASTER)).toEqual([
      { lang: "ru", name: "rus0", default: true },
      { lang: "uk", name: "ukr6", default: false },
      { lang: "en", name: "eng8", default: false },
    ]);
  });

  it("feeds pickAudioTrack the original-language rendition", () => {
    const renditions = parseHlsAudioRenditions(MASTER);
    expect(renditions[pickAudioTrack(renditions, ["ja", "en"])].name).toBe("eng8");
  });

  it("handles unquoted values and a missing LANGUAGE", () => {
    expect(parseHlsAudioRenditions("#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=aac,NAME=Main,DEFAULT=YES")).toEqual([
      { lang: undefined, name: "Main", default: true },
    ]);
  });

  it("is empty for single-audio, video-only or blank playlists", () => {
    expect(parseHlsAudioRenditions("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8")).toEqual([]);
    expect(parseHlsAudioRenditions("")).toEqual([]);
  });
});

// Shape of a real Collaps master: six Russian dubs (first DEFAULT), two
// Ukrainian, then the original English last.
const COLLAPS = [
  { name: "rus0", lang: "ru", default: true },
  { name: "rus1", lang: "ru" },
  { name: "rus2", lang: "ru" },
  { name: "ukr6", lang: "uk" },
  { name: "ukr7", lang: "uk" },
  { name: "eng8", lang: "en" },
];

describe("normalizeLang", () => {
  it("maps two-letter, three-letter, full names and region tags", () => {
    expect(normalizeLang("en")).toBe("en");
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("eng")).toBe("en");
    expect(normalizeLang("English")).toBe("en");
    expect(normalizeLang("jpn")).toBe("ja");
    expect(normalizeLang("pt_BR")).toBe("pt");
  });

  it("reads the letters of rendition NAMEs like eng8 / rus0", () => {
    expect(normalizeLang("eng8")).toBe("en");
    expect(normalizeLang("rus0")).toBe("ru");
  });

  it("is empty for unknown, blank and nullish input", () => {
    expect(normalizeLang("")).toBe("");
    expect(normalizeLang("   ")).toBe("");
    expect(normalizeLang(undefined)).toBe("");
    expect(normalizeLang(null)).toBe("");
    expect(normalizeLang("AlexFilm")).toBe("");
    expect(normalizeLang("8")).toBe("");
  });
});

describe("pickAudioTrack", () => {
  it("prefers the requested language over the stream DEFAULT", () => {
    expect(pickAudioTrack(COLLAPS, ["en"])).toBe(5);
  });

  it("walks the preference list in order (anime default ja, en)", () => {
    expect(pickAudioTrack(COLLAPS, ["ja", "en"])).toBe(5);
    expect(pickAudioTrack(COLLAPS, ["uk", "en"])).toBe(3);
  });

  it("keeps the stream DEFAULT when it is the preferred language", () => {
    expect(pickAudioTrack(COLLAPS, ["ru"])).toBe(0);
    const tracks = [{ lang: "en" }, { lang: "en", default: true }];
    expect(pickAudioTrack(tracks, ["en"])).toBe(1);
  });

  it("falls back to the NAME when LANGUAGE is missing", () => {
    expect(pickAudioTrack([{ name: "rus0", default: true }, { name: "eng8" }], ["en"])).toBe(1);
  });

  it("falls back to DEFAULT, then the first track, when nothing matches", () => {
    expect(pickAudioTrack(COLLAPS, ["fr"])).toBe(0);
    expect(pickAudioTrack([{ lang: "ru" }, { lang: "uk", default: true }], ["fr"])).toBe(1);
    expect(pickAudioTrack([{ lang: "ru" }, { lang: "uk" }], [])).toBe(0);
    expect(pickAudioTrack([{ lang: "ru" }], ["", "xx-YY-garbage"])).toBe(0);
  });

  it("is -1 without tracks", () => {
    expect(pickAudioTrack([], ["en"])).toBe(-1);
  });
});
