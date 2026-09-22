import { describe, it, expect, afterEach, vi } from "vitest";
import {
  sniffManifest,
  sniffHls,
  stripHevcManifest,
  browserSupportsHevc,
  pickPlayableManifest,
  isoDurationToSeconds,
  parseMpdDuration,
  rewriteRelativeTo,
} from "../playback";

const AVC_MANIFEST = `<MPD mediaPresentationDuration="PT1H30M0S">
<Period>
<AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.640028">
<Representation id="v0" bandwidth="800000" codecs="avc1.640028"><BaseURL>v0/</BaseURL></Representation>
<Representation id="v1" bandwidth="2000000" codecs="avc1.640028"><BaseURL>v1/</BaseURL></Representation>
</AdaptationSet>
<AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2">
<Representation id="a0" bandwidth="128000"/>
</AdaptationSet>
</Period>
</MPD>`;

const HEVC_ONLY_MANIFEST = `<MPD mediaPresentationDuration="PT2H28M7.9S">
<Period>
<AdaptationSet contentType="video" mimeType="video/mp4">
<Representation id="v0" bandwidth="1000000" codecs="hev1.1.6.L120.90"/>
<Representation id="v1" bandwidth="3000000" codecs="hvc1.1.6.L120.90"/>
</AdaptationSet>
<AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2">
<Representation id="a0" bandwidth="128000"/>
</AdaptationSet>
</Period>
</MPD>`;

const MIXED_MANIFEST = `<MPD>
<Period>
<AdaptationSet contentType="video" mimeType="video/mp4">
<Representation id="v-hevc" bandwidth="3000000" codecs="hev1.1.6.L120.90"/>
<Representation id="v-avc" bandwidth="1000000" codecs="avc1.640028"/>
</AdaptationSet>
<AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2">
<Representation id="a0" bandwidth="128000"/>
</AdaptationSet>
</Period>
</MPD>`;

const SET_LEVEL_HEVC_MIXED = `<MPD>
<Period>
<AdaptationSet contentType="video" mimeType="video/mp4" codecs="hev1.1.6.L120.90">
<Representation id="v0" bandwidth="1000000"/>
<Representation id="v1" bandwidth="3000000"/>
</AdaptationSet>
<AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.640028">
<Representation id="v2" bandwidth="800000"/>
</AdaptationSet>
</Period>
</MPD>`;

const ALL_HEVC_SET_PLUS_AVC = `<MPD>
<Period>
<AdaptationSet contentType="video" mimeType="video/mp4">
<Representation id="h0" bandwidth="1000000" codecs="hev1.1.6.L120.90"/>
<Representation id="h1" bandwidth="3000000" codecs="hev1.1.6.L120.90"/>
</AdaptationSet>
<AdaptationSet contentType="video" mimeType="video/mp4">
<Representation id="v0" bandwidth="800000" codecs="avc1.640028"/>
</AdaptationSet>
</Period>
</MPD>`;

// HEVC-family codecs on a non-Representation inner element: sniffable but
// not strippable (no per-rep and no set-level codecs to key on).
const UNSTRIPPABLE_MIXED = `<MPD>
<Period>
<AdaptationSet contentType="video" mimeType="video/mp4">
<Role codecs="hev1.1.6.L120.90"/>
<Representation id="v0" bandwidth="1000000" codecs="avc1.640028"/>
</AdaptationSet>
<AdaptationSet contentType="video" mimeType="video/mp4">
<Representation id="v1" bandwidth="800000" codecs="avc1.640028"/>
</AdaptationSet>
</Period>
</MPD>`;

const DV_ONLY_MANIFEST = `<MPD>
<Period>
<AdaptationSet contentType="video" mimeType="video/mp4" codecs="dvh1.05.01">
<Representation id="v0" bandwidth="5000000" codecs="dvh1.05.01"/>
</AdaptationSet>
</Period>
</MPD>`;

const AUDIO_ONLY_MANIFEST = `<MPD>
<Period>
<AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2">
<Representation id="a0" bandwidth="128000"/>
</AdaptationSet>
<AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="ec-3">
<Representation id="a1" bandwidth="256000"/>
</AdaptationSet>
</Period>
</MPD>`;

const MARKERLESS_HEVC = `<MPD>
<Period>
<AdaptationSet>
<Representation id="v0" bandwidth="1000000" codecs="hev1.1.6.L120.90"/>
</AdaptationSet>
</Period>
</MPD>`;

const AV1_HEVC_MIXED = `<MPD>
<Period>
<AdaptationSet contentType="video" mimeType="video/mp4" codecs="hev1.1.6.L120.90">
<Representation id="v0" bandwidth="1000000"/>
</AdaptationSet>
<AdaptationSet contentType="video" mimeType="video/webm" codecs="av01.0.05M.08">
<Representation id="v1" bandwidth="800000"/>
</AdaptationSet>
</Period>
</MPD>`;

describe("sniffManifest", () => {
  it("reports empty families for an empty manifest", () => {
    expect(sniffManifest("")).toEqual({ videoCodecs: [], hevcOnly: false, hasAvc: false, hasFallback: false });
  });
  it("reports empty families for garbage input", () => {
    const s = sniffManifest("not xml at all <><>> 日本語 🎬");
    expect(s.videoCodecs).toEqual([]);
    expect(s.hevcOnly).toBe(false);
  });
  it("detects AVC video and ignores audio codecs", () => {
    const s = sniffManifest(AVC_MANIFEST);
    expect(s.videoCodecs).toContain("avc");
    expect(s.videoCodecs).not.toContain("hevc");
    expect(s.hasAvc).toBe(true);
    expect(s.hevcOnly).toBe(false);
    expect(s.hasFallback).toBe(true);
  });
  it("flags an HEVC-only manifest", () => {
    const s = sniffManifest(HEVC_ONLY_MANIFEST);
    expect(s.videoCodecs).toContain("hevc");
    expect(s.hevcOnly).toBe(true);
    expect(s.hasAvc).toBe(false);
    expect(s.hasFallback).toBe(false);
  });
  it("treats mixed HEVC+AVC as non-hevcOnly with fallback", () => {
    const s = sniffManifest(MIXED_MANIFEST);
    expect(s.hevcOnly).toBe(false);
    expect(s.hasAvc).toBe(true);
    expect(s.hasFallback).toBe(true);
  });
  it("treats Dolby Vision as HEVC-family", () => {
    expect(sniffManifest(DV_ONLY_MANIFEST).hevcOnly).toBe(true);
  });
  it("ignores audio-only manifests", () => {
    const s = sniffManifest(AUDIO_ONLY_MANIFEST);
    expect(s.videoCodecs).toEqual([]);
    expect(s.hevcOnly).toBe(false);
  });
  it("detects marker-less video sets by codec", () => {
    expect(sniffManifest(MARKERLESS_HEVC).hevcOnly).toBe(true);
  });
  it("accepts AV1 as a broadly-decodable fallback", () => {
    const s = sniffManifest(AV1_HEVC_MIXED);
    expect(s.hasFallback).toBe(true);
    expect(s.hevcOnly).toBe(false);
  });
  it("reads codecs from both set-level and per-representation attributes", () => {
    expect(sniffManifest(SET_LEVEL_HEVC_MIXED).hevcOnly).toBe(false);
    expect(sniffManifest(SET_LEVEL_HEVC_MIXED).hasAvc).toBe(true);
  });
  it("handles oversize manifests without hanging", () => {
    const big = HEVC_ONLY_MANIFEST.repeat(500);
    const s = sniffManifest(big);
    expect(s.hevcOnly).toBe(true);
  });
});

describe("sniffHls", () => {
  const AVC_MASTER = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.640028,mp4a.40.2"\nlow.m3u8\n`;
  const HEVC_MASTER = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="hev1.1.6.L120.90,mp4a.40.2"\nhi.m3u8\n`;
  it("reports empty families for an empty playlist", () => {
    expect(sniffHls("")).toEqual({ videoCodecs: [], hevcOnly: false, hasAvc: false, hasFallback: false });
  });
  it("reports empty families for garbage input", () => {
    expect(sniffHls("hello world").hevcOnly).toBe(false);
  });
  it("detects AVC variants and skips audio codecs", () => {
    const s = sniffHls(AVC_MASTER);
    expect(s.hasAvc).toBe(true);
    expect(s.hevcOnly).toBe(false);
  });
  it("flags HEVC-only variants", () => {
    const s = sniffHls(HEVC_MASTER);
    expect(s.videoCodecs).toContain("hevc");
    expect(s.hevcOnly).toBe(true);
  });
  it("reads single-quoted CODECS attributes", () => {
    expect(sniffHls(`#EXT-X-STREAM-INF:CODECS='hvc1.1.6.L120.90'\na.m3u8`).hevcOnly).toBe(true);
  });
  it("never flags a playlist without CODECS as hevcOnly", () => {
    const media = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg0.ts\n";
    expect(sniffHls(media).hevcOnly).toBe(false);
  });
  it("treats mixed HEVC+AVC variants as fallback-capable", () => {
    const s = sniffHls(`${AVC_MASTER}${HEVC_MASTER}`);
    expect(s.hevcOnly).toBe(false);
    expect(s.hasFallback).toBe(true);
  });
  it("matches codec names case-insensitively", () => {
    expect(sniffHls('#EXT-X-STREAM-INF:CODECS="HEV1.1.6.L120.90"\na.m3u8').hevcOnly).toBe(true);
  });
  it("treats Dolby Vision HLS variants as HEVC", () => {
    expect(sniffHls('#EXT-X-STREAM-INF:CODECS="dvh1.05.01,mp4a.40.2"\na.m3u8').hevcOnly).toBe(true);
  });
  it("accepts VP9 as fallback", () => {
    const s = sniffHls('#EXT-X-STREAM-INF:CODECS="hev1.1.6.L120.90"\na\n#EXT-X-STREAM-INF:CODECS="vp09.00.10.08"\nb');
    expect(s.hasFallback).toBe(true);
    expect(s.hevcOnly).toBe(false);
  });
});

describe("stripHevcManifest", () => {
  it("leaves AVC-only manifests untouched", () => {
    const r = stripHevcManifest(AVC_MANIFEST);
    expect(r.removed).toBe(0);
    expect(r.text).toBe(AVC_MANIFEST);
  });
  it("leaves HEVC-only manifests untouched (nothing to fall back to)", () => {
    const r = stripHevcManifest(HEVC_ONLY_MANIFEST);
    expect(r.removed).toBe(0);
    expect(r.text).toBe(HEVC_ONLY_MANIFEST);
  });
  it("removes per-representation HEVC entries from mixed manifests", () => {
    const r = stripHevcManifest(MIXED_MANIFEST);
    expect(r.removed).toBe(1);
    expect(r.text).not.toContain("hev1");
    expect(r.text).toContain("avc1");
  });
  it("drops whole sets whose opening tag declares HEVC", () => {
    const r = stripHevcManifest(SET_LEVEL_HEVC_MIXED);
    expect(r.removed).toBe(2);
    expect(r.text).not.toContain("hev1");
    expect(r.text).toContain("avc1");
  });
  it("drops sets left with zero representations", () => {
    const r = stripHevcManifest(ALL_HEVC_SET_PLUS_AVC);
    expect(r.removed).toBe(2);
    expect(r.text).not.toMatch(/id="h0"|id="h1"/);
    expect(r.text).toContain('id="v0"');
  });
  it("removes Dolby Vision representations like HEVC", () => {
    const mixed = MIXED_MANIFEST.replace("hev1.1.6.L120.90", "dvhe.05.01");
    const r = stripHevcManifest(mixed);
    expect(r.removed).toBe(1);
    expect(r.text).not.toContain("dvhe");
  });
  it("returns empty/garbage input untouched", () => {
    expect(stripHevcManifest("")).toEqual({ text: "", removed: 0 });
    expect(stripHevcManifest("garbage").removed).toBe(0);
  });
});

describe("browserSupportsHevc", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const el = (answer: string) => ({ canPlayType: () => answer }) as unknown as HTMLVideoElement;
  const noDom = () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", undefined);
  };

  it("returns false with no DOM and no element", () => {
    noDom();
    expect(browserSupportsHevc()).toBe(false);
  });
  it("returns true when MSE probing approves an HEVC form", () => {
    vi.stubGlobal("window", { MediaSource: { isTypeSupported: () => true } });
    expect(browserSupportsHevc()).toBe(true);
  });
  it("returns false when MSE is present but rejects every HEVC form", () => {
    vi.stubGlobal("window", { MediaSource: { isTypeSupported: () => false } });
    expect(browserSupportsHevc(el("probably"))).toBe(false);
  });
  it("trusts canPlayType probably when MSE probing is unavailable", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", undefined);
    expect(browserSupportsHevc(el("probably"))).toBe(true);
  });
  it("trusts canPlayType maybe as support", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", undefined);
    expect(browserSupportsHevc(el("maybe"))).toBe(true);
  });
  it("returns false when canPlayType reports empty on a non-Safari UA", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36" });
    expect(browserSupportsHevc(el(""))).toBe(false);
  });
  it("accepts the Safari short-form hint on Safari", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15" });
    const video = { canPlayType: (t: string) => (t.includes("hev1.1.6") ? "" : "maybe") } as unknown as HTMLVideoElement;
    expect(browserSupportsHevc(video)).toBe(true);
  });
  it("ignores the short-form hint on Chrome", () => {
    // Chrome's UA contains "Safari/537.36" but also "Chrome/120.0", so the
    // Safari-only branch must not fire: short-form "maybe" alone is not
    // support. The stub answers "" for every probe (fully-qualified and
    // short-form alike) to model a Chrome build with no HEVC decode.
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36" });
    const video = { canPlayType: () => "" } as unknown as HTMLVideoElement;
    expect(browserSupportsHevc(video)).toBe(false);
  });
  it("survives a throwing MediaSource probe and keeps checking", () => {
    let calls = 0;
    vi.stubGlobal("window", {
      MediaSource: {
        isTypeSupported: () => {
          calls += 1;
          if (calls < 3) throw new Error("bad probe");
          return true;
        },
      },
    });
    expect(browserSupportsHevc()).toBe(true);
    expect(calls).toBe(3);
  });
  it("falls back to canPlayType when reading MediaSource throws", () => {
    vi.stubGlobal("window", {
      get MediaSource(): unknown {
        throw new Error("denied");
      },
    });
    vi.stubGlobal("document", undefined);
    expect(browserSupportsHevc(el("probably"))).toBe(true);
  });
  it("returns false for an element without canPlayType", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", undefined);
    expect(browserSupportsHevc({} as HTMLVideoElement)).toBe(false);
  });
  it("uses document.createElement when no element is passed", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
    vi.stubGlobal("navigator", undefined);
    expect(browserSupportsHevc()).toBe(true);
  });
});

describe("pickPlayableManifest", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const noHevc = () => {
    vi.stubGlobal("window", { MediaSource: { isTypeSupported: () => false } });
  };
  const hasHevc = () => {
    vi.stubGlobal("window", { MediaSource: { isTypeSupported: () => true } });
  };

  it("plays plain AVC manifests as DASH untouched", () => {
    noHevc();
    expect(pickPlayableManifest(AVC_MANIFEST)).toEqual({ mode: "dash", text: AVC_MANIFEST, stripped: false, hevcOnly: false });
  });
  it("routes HEVC-only to transcode on an HEVC-less browser", () => {
    noHevc();
    expect(pickPlayableManifest(HEVC_ONLY_MANIFEST)).toEqual({ mode: "transcode", hevcOnly: true });
  });
  it("plays HEVC-only DASH as-is on an HEVC-capable browser", () => {
    hasHevc();
    expect(pickPlayableManifest(HEVC_ONLY_MANIFEST)).toEqual({
      mode: "dash",
      text: HEVC_ONLY_MANIFEST,
      stripped: false,
      hevcOnly: true,
    });
  });
  it("strips mixed manifests to playable DASH", () => {
    noHevc();
    const d = pickPlayableManifest(MIXED_MANIFEST);
    expect(d.mode).toBe("dash");
    if (d.mode === "dash") {
      expect(d.stripped).toBe(true);
      expect(d.hevcOnly).toBe(false);
      expect(d.text).not.toContain("hev1");
    }
  });
  it("sends unstrippable mixed manifests to transcode on HEVC-less browsers", () => {
    noHevc();
    expect(pickPlayableManifest(UNSTRIPPABLE_MIXED)).toEqual({ mode: "transcode", hevcOnly: true });
  });
  it("plays unstrippable mixed manifests as DASH on HEVC-capable browsers", () => {
    hasHevc();
    const d = pickPlayableManifest(UNSTRIPPABLE_MIXED);
    expect(d.mode).toBe("dash");
  });
  it("treats empty input as plain DASH", () => {
    noHevc();
    const d = pickPlayableManifest("");
    expect(d).toEqual({ mode: "dash", text: "", stripped: false, hevcOnly: false });
  });
});

describe("isoDurationToSeconds", () => {
  it("converts a full H/M/S duration", () => expect(isoDurationToSeconds("PT2H28M7.9S")).toBeCloseTo(8887.9));
  it("converts minutes only", () => expect(isoDurationToSeconds("PT45M")).toBe(2700));
  it("converts minutes and seconds", () => expect(isoDurationToSeconds("PT1M2S")).toBe(62));
  it("converts zero seconds to 0", () => expect(isoDurationToSeconds("PT0S")).toBe(0));
  it("rejects bare PT with no components", () => expect(isoDurationToSeconds("PT")).toBeNull());
  it("rejects empty and garbage input", () => {
    expect(isoDurationToSeconds("")).toBeNull();
    expect(isoDurationToSeconds("hello")).toBeNull();
    expect(isoDurationToSeconds("日本語")).toBeNull();
  });
  it("parses case-insensitively and trims whitespace", () => {
    expect(isoDurationToSeconds("pt1h")).toBe(3600);
    expect(isoDurationToSeconds("  PT1M  ")).toBe(60);
  });
  it("supports fractional hours and minutes", () => {
    expect(isoDurationToSeconds("PT1.5H")).toBe(5400);
    expect(isoDurationToSeconds("PT0.5M")).toBe(30);
  });
  it("rejects day-based and negative forms", () => {
    expect(isoDurationToSeconds("P1DT2H")).toBeNull();
    expect(isoDurationToSeconds("-PT1M")).toBeNull();
  });
  it("converts hours only", () => expect(isoDurationToSeconds("PT2H")).toBe(7200));
});

describe("parseMpdDuration", () => {
  it("reads mediaPresentationDuration in seconds", () =>
    expect(parseMpdDuration(HEVC_ONLY_MANIFEST)).toBeCloseTo(8887.9));
  it("returns null when the attribute is absent", () =>
    expect(parseMpdDuration(MIXED_MANIFEST)).toBeNull());
  it("reads single-quoted attributes", () =>
    expect(parseMpdDuration(`<MPD mediaPresentationDuration='PT1M'>`)).toBe(60));
  it("returns null for an unparseable value", () =>
    expect(parseMpdDuration(`<MPD mediaPresentationDuration='soon'>`)).toBeNull());
  it("returns null for empty input", () => expect(parseMpdDuration("")).toBeNull());
  it("tolerates whitespace around the equals sign", () =>
    expect(parseMpdDuration(`<MPD mediaPresentationDuration = "PT30S">`)).toBe(30));
  it("uses the first attribute when duplicated", () =>
    expect(parseMpdDuration(`<MPD mediaPresentationDuration="PT10S" mediaPresentationDuration="PT20S">`)).toBe(10));
});

describe("rewriteRelativeTo", () => {
  const BASE = "https://host/api/proxy/ticket/a/dash/xxx/";
  const MANIFEST = `<MPD><Period><AdaptationSet>
<SegmentTemplate media="chunk-stream$Number$.m4s" initialization="init-stream$Number$.mp4"/>
<BaseURL>segments/</BaseURL>
</AdaptationSet></Period></MPD>`;
  it("returns input unchanged for an empty base", () => {
    expect(rewriteRelativeTo("", MANIFEST)).toBe(MANIFEST);
  });
  it("prefixes relative SegmentTemplate media/initialization", () => {
    const out = rewriteRelativeTo(BASE, MANIFEST);
    expect(out).toContain(`${BASE}chunk-stream$Number$.m4s`);
    expect(out).toContain(`${BASE}init-stream$Number$.mp4`);
  });
  it("prefixes relative BaseURL contents", () => {
    expect(rewriteRelativeTo(BASE, MANIFEST)).toContain(`${BASE}segments/`);
  });
  it("leaves absolute https URLs alone", () => {
    const abs = MANIFEST.replace("chunk-stream$Number$.m4s", "https://cdn/x/chunk.m4s");
    expect(rewriteRelativeTo(BASE, abs)).toContain("https://cdn/x/chunk.m4s");
    expect(rewriteRelativeTo(BASE, abs)).not.toContain(BASE + "https");
  });
  it("leaves root-relative and protocol-relative URLs alone", () => {
    expect(rewriteRelativeTo(BASE, `<BaseURL>/abs/path/</BaseURL>`)).toContain("/abs/path/");
    expect(rewriteRelativeTo(BASE, `<BaseURL>//cdn/path/</BaseURL>`)).toContain("//cdn/path/");
  });
  it("is idempotent on already-rewritten manifests", () => {
    const once = rewriteRelativeTo(BASE, MANIFEST);
    expect(rewriteRelativeTo(BASE, once)).toBe(once);
  });
  it("prefixes bare init/chunk tokens via the catch-all", () => {
    const out = rewriteRelativeTo(BASE, `<MPD>"init-stream$foo"</MPD>`);
    expect(out).toContain(`${BASE}init-stream$foo`);
  });
  it("leaves empty BaseURL elements alone", () => {
    const empty = `<MPD><BaseURL>  </BaseURL></MPD>`;
    expect(rewriteRelativeTo(BASE, empty)).toBe(empty);
  });
  it("rewrites SegmentList media attributes", () => {
    const out = rewriteRelativeTo(BASE, `<SegmentList media="seg-$Number$.m4s"/>`);
    expect(out).toContain(`${BASE}seg-$Number$.m4s`);
  });
  it("handles unicode segment paths", () => {
    const out = rewriteRelativeTo(BASE, `<BaseURL>日本語/セグメント/</BaseURL>`);
    expect(out).toContain(`${BASE}日本語/セグメント/`);
  });
});
