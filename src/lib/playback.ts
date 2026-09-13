// Client-side HEVC handling for DASH + HLS sources.
//
// MovieBox DASH manifests are frequently HEVC-only (`codecs="hev1..."`), which
// Chromium/Linux and most Chrome builds cannot decode through MSE: dash.js then
// plays only the audio AdaptationSet → black screen with an advancing timeline.
// Dolby Vision (`dvh1`/`dvhe`, HEVC-based) fails the same way on non-DV
// decoders. These helpers sniff a manifest for HEVC-family video and either
// strip those representations (when a broadly-decodable fallback exists) or
// flag the source for live server-side transcoding.

export interface Sniff {
  /** normalized video codec families present, e.g. ["hevc"] or ["hevc","avc"] */
  videoCodecs: string[];
  /** video needs HEVC-family decode with no broadly-decodable fallback present */
  hevcOnly: boolean;
  /** at least one AVC (avc1/avc3) video codec present */
  hasAvc: boolean;
  /** at least one broadly-decodable fallback (avc/av1/vp9) present */
  hasFallback: boolean;
}

export type ManifestDecision =
  | { mode: "transcode"; hevcOnly: true }
  | {
      mode: "dash";
      /** manifest text to feed the player (stripped, rewritten, or original) */
      text: string;
      /** true when the text was produced by stripping HEVC representations */
      stripped: boolean;
      /** manifest contained HEVC video with no AVC fallback */
      hevcOnly: boolean;
    };

const ADAPTATION_SET_RE = /<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/gi;
// Matches paired AND self-closing Representations (MovieBox uses both).
const REPRESENTATION_RE = /<Representation\b[^>]*(?:\/>|>[\s\S]*?<\/Representation>)/gi;
// HEVC-family sample entries, including Dolby Vision (HEVC-based: undecodable
// on non-DV decoders, same black+audio failure).
const HEVC_CODEC_RE = /hev1|hev2|hvc1|hvc2|dvh1|dvhe|dvh2|dvav|dva1/i;

/** Normalize a codecs= attribute payload into a set of known families. */
function codecFamilies(codecsAttr: string): string[] {
  if (typeof codecsAttr !== "string" || codecsAttr === "") return [];
  const out: string[] = [];
  for (const raw of codecsAttr.split(",")) {
    const fam = raw.trim().split(".")[0].toLowerCase();
    if (
      fam === "hev1" ||
      fam === "hev2" ||
      fam === "hvc1" ||
      fam === "hvc2"
    ) {
      out.push("hevc");
    } else if (
      fam === "dvh1" ||
      fam === "dvhe" ||
      fam === "dvh2" ||
      fam === "dvav" ||
      fam === "dva1"
    ) {
      // Dolby Vision is HEVC-based: route/strip it exactly like HEVC.
      out.push("hevc");
    } else if (fam === "avc1" || fam === "avc3") out.push("avc");
    else if (fam === "av01") out.push("av1");
    else if (fam === "vp09") out.push("vp9");
    // unknown families (mp4a, ec-3, ...) are ignored
  }
  return out;
}

function collectFamilies(scope: string): string[] {
  if (typeof scope !== "string" || scope === "") return [];
  const seen = new Set<string>();
  const re = /codecs\s*=\s*["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    for (const fam of codecFamilies(m[1])) seen.add(fam);
  }
  return [...seen];
}

/** Video families (undecodable-or-not) that mark a set as video, not audio. */
const VIDEO_FAMILIES: Record<string, true> = { hevc: true, avc: true, av1: true, vp9: true };

/**
 * Scan a DASH manifest for its video codec families.
 *
 * Audio-only AdaptationSets are ignored by looking for a
 * `contentType="video"` / `mimeType="video/..."` marker inside each set
 * (markers on inner Representations count: the whole set string is scanned).
 * A set that carries a known video codec but no explicit marker is still
 * treated as video, so marker-less video sets are never mistaken for audio.
 * If no set carries a video marker at all (defensive), every set that lists
 * codecs is treated as video so we still detect HEVC-only streams.
 *
 * Codecs may live on the AdaptationSet opening tag or on individual
 * Representations — both are inside the set scope, so both are sniffed.
 */
export function sniffManifest(text: string): Sniff {
  if (typeof text !== "string" || text === "") {
    return { videoCodecs: [], hevcOnly: false, hasAvc: false, hasFallback: false };
  }
  const sets: string[] = [];
  let m: RegExpExecArray | null;
  const adaptRe = new RegExp(ADAPTATION_SET_RE.source, "gi");
  while ((m = adaptRe.exec(text)) !== null) sets.push(m[0]);

  const families = new Set<string>();
  const isVideoSet = (set: string): boolean => {
    const lower = set.toLowerCase();
    if (
      /contenttype\s*=\s*["']video["']/.test(lower) ||
      /mimetype\s*=\s*["']video\//.test(lower)
    ) {
      return true;
    }
    return collectFamilies(set).some((fam) => VIDEO_FAMILIES[fam] === true);
  };
  let sawVideoMarker = false;
  for (const set of sets) {
    const lower = set.toLowerCase();
    if (
      /contenttype\s*=\s*["']video["']/.test(lower) ||
      /mimetype\s*=\s*["']video\//.test(lower)
    ) {
      sawVideoMarker = true;
    }
  }
  for (const set of sets) {
    if (sawVideoMarker && !isVideoSet(set)) continue;
    for (const fam of collectFamilies(set)) families.add(fam);
  }

  // No <AdaptationSet> structure at all — scan the document defensively.
  if (!sets.length) {
    for (const fam of collectFamilies(text)) families.add(fam);
  }

  const videoCodecs = [...families];
  const hasAvc = videoCodecs.includes("avc");
  const hasHevc = videoCodecs.includes("hevc");
  const hasFallback =
    hasAvc || videoCodecs.includes("av1") || videoCodecs.includes("vp9");
  return { videoCodecs, hevcOnly: hasHevc && !hasFallback, hasAvc, hasFallback };
}

/**
 * Scan an HLS playlist for its video codec families. Master playlists carry
 * per-variant `CODECS="..."` attributes; the same families as DASH apply
 * (HEVC-family variants are undecodable through MSE on most Chrome builds).
 * A playlist with no CODECS attributes yields no families (unknown, never
 * hevcOnly) so it still plays instead of misrouting to transcode.
 */
export function sniffHls(text: string): Sniff {
  if (typeof text !== "string" || text === "") {
    return { videoCodecs: [], hevcOnly: false, hasAvc: false, hasFallback: false };
  }
  const families = new Set<string>();
  const re = /codecs\s*=\s*["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const fam of codecFamilies(m[1])) families.add(fam);
  }
  const videoCodecs = [...families];
  const hasAvc = videoCodecs.includes("avc");
  const hasHevc = videoCodecs.includes("hevc");
  const hasFallback =
    hasAvc || videoCodecs.includes("av1") || videoCodecs.includes("vp9");
  return { videoCodecs, hevcOnly: hasHevc && !hasFallback, hasAvc, hasFallback };
}

export interface StripResult {
  text: string;
  removed: number;
}

/**
 * Remove HEVC-family `<Representation>` elements from a manifest that also
 * contains a broadly-decodable (AVC/AV1/VP9) fallback. String-level, no DOM
 * required. Returns the input untouched (removed: 0) unless both HEVC-family
 * and fallback video codecs are present.
 *
 * Handles codecs declared per-Representation AND on the AdaptationSet opening
 * tag (whole-set HEVC: the set is dropped). AdaptationSets left with zero
 * Representations are dropped entirely so dash.js never chokes on an empty
 * set.
 */
export function stripHevcManifest(text: string): StripResult {
  if (typeof text !== "string" || text === "") {
    return { text: typeof text === "string" ? text : "", removed: 0 };
  }
  const sniff = sniffManifest(text);
  if (!sniff.hasFallback || !sniff.videoCodecs.includes("hevc")) {
    return { text, removed: 0 };
  }
  const repRe = new RegExp(REPRESENTATION_RE.source, "gi");
  const hevcRepOpen =
    /<Representation\b[^>]*\bcodecs\s*=\s*["'][^"']*(hev1|hev2|hvc1|hvc2|dvh1|dvhe|dvh2|dvav|dva1)[^"']*["'][^>]*>/i;
  let removed = 0;
  const out = text.replace(
    new RegExp(ADAPTATION_SET_RE.source, "gi"),
    (set) => {
      if (!collectFamilies(set).includes("hevc")) return set;
      const stripped = set.replace(repRe, (whole) => {
        if (hevcRepOpen.test(whole)) {
          removed += 1;
          return "";
        }
        return whole;
      });
      if (stripped !== set) {
        // Some HEVC reps dropped: keep the set only if video reps remain.
        if (!/<Representation\b/i.test(stripped)) return "";
        return stripped;
      }
      // No per-Representation codecs (codecs live on the AdaptationSet tag):
      // a set whose own opening tag declares HEVC-family video is entirely
      // HEVC — drop the whole set.
      const openTag = set.match(/<AdaptationSet\b[^>]*>/i)?.[0] ?? "";
      const openCodecs = openTag.match(/\bcodecs\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
      if (openCodecs !== "" && HEVC_CODEC_RE.test(openCodecs)) {
        const repCount = new RegExp(REPRESENTATION_RE.source, "gi");
        let n = 0;
        while (repCount.exec(set) !== null) n += 1;
        removed += n;
        return "";
      }
      return set;
    },
  );
  if (removed === 0) return { text, removed: 0 };
  return { text: out, removed };
}

/**
 * True when the browser can decode HEVC (H.265) for MSE playback (dash.js /
 * hls.js). Probes `MediaSource.isTypeSupported` first: it reflects the actual
 * MSE decoder, while `canPlayType("maybe")` false-positives on Chromium
 * builds that then play audio-only. Falls back to `canPlayType` only where
 * MSE probing is unavailable. Includes both the `hev1` and `hvc1`
 * sample-entry forms plus a Safari short-form hint.
 */
export function browserSupportsHevc(videoEl?: HTMLVideoElement | null): boolean {
  if (typeof window !== "undefined") {
    try {
      const ms = (window as unknown as { MediaSource?: { isTypeSupported?: (t: string) => boolean } }).MediaSource;
      if (ms != null && typeof ms.isTypeSupported === "function") {
        const probes = [
          'video/mp4; codecs="hvc1.1.6.L120.90"',
          'video/mp4; codecs="hev1.1.6.L120.90"',
          'video/mp4; codecs="hvc1"',
          'video/mp4; codecs="hev1"',
        ];
        for (const p of probes) {
          try {
            if (ms.isTypeSupported(p)) return true;
          } catch {
            /* ignore a single bad probe */
          }
        }
        // MSE is present and explicitly rejects every HEVC form: the MSE
        // playback paths (dash.js, hls.js) cannot decode HEVC here.
        return false;
      }
    } catch {
      /* fall through to canPlayType */
    }
  }
  if (videoEl == null && typeof document === "undefined") return false;
  let video: HTMLVideoElement | null = null;
  try {
    video = videoEl ?? document.createElement("video");
  } catch {
    return false;
  }
  if (video == null || typeof video.canPlayType !== "function") return false;
  const target: HTMLVideoElement = video;
  const hev1 = target.canPlayType('video/mp4; codecs="hev1.1.6.L120.90"');
  const hvc1 = target.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"');
  if (hev1 === "probably" || hvc1 === "probably") return true;
  if (hev1 === "maybe" || hvc1 === "maybe") return true;
  // Safari hint: HEVC-capable Safari reports the short form when it refuses the
  // fully-qualified profile string.
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent;
    const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium/.test(ua);
    if (isSafari && (target.canPlayType('video/mp4; codecs="hev1"') !== "" || target.canPlayType('video/mp4; codecs="hvc1"') !== "")) return true;
  }
  return false;
}

/**
 * Decide how a manifest should be played:
 *  - HEVC-only + unsupported browser → server-side transcode (HLS)
 *  - HEVC-only + supported browser   → play the DASH stream as-is
 *  - mixed HEVC+fallback             → strip HEVC reps, play remaining video;
 *    when stripping removes nothing (e.g. set-level codecs the stripper
 *    cannot split) an unsupported browser still goes to transcode — never
 *    silent black+audio.
 *  - otherwise                       → plain DASH
 */
export function pickPlayableManifest(
  text: string,
  videoEl?: HTMLVideoElement | null,
): ManifestDecision {
  if (typeof text !== "string" || text === "") {
    return { mode: "dash", text: typeof text === "string" ? text : "", stripped: false, hevcOnly: false };
  }
  const sniff = sniffManifest(text);
  const hevc = sniff.videoCodecs.includes("hevc");
  if (hevc && sniff.hevcOnly) {
    if (!browserSupportsHevc(videoEl)) return { mode: "transcode", hevcOnly: true };
    return { mode: "dash", text, stripped: false, hevcOnly: true };
  }
  if (hevc && sniff.hasFallback) {
    const stripped = stripHevcManifest(text);
    if (stripped.removed > 0) {
      return { mode: "dash", text: stripped.text, stripped: true, hevcOnly: false };
    }
    // Unstrippable mixed manifest on an HEVC-less browser: transcoding is the
    // only path that cannot end in audio-only playback.
    if (!browserSupportsHevc(videoEl)) return { mode: "transcode", hevcOnly: true };
  }
  return { mode: "dash", text, stripped: false, hevcOnly: false };
}

/**
 * Convert an ISO-8601 duration (`PT#H#M#S`, any component optional, seconds
 * may carry fractions, e.g. `PT2H28M7.9S`, `PT45M`, `PT1M2S`) into seconds.
 * Returns null when the value is absent or does not parse.
 */
export function isoDurationToSeconds(raw: string): number | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(
    /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i,
  );
  if (!m) return null;
  // "PT" with no component is not a real duration.
  if (m[1] == null && m[2] == null && m[3] == null) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const total = h * 3600 + min * 60 + s;
  return Number.isFinite(total) ? total : null;
}

/**
 * Parse the MPD `mediaPresentationDuration` attribute out of a DASH manifest
 * and return it in seconds (e.g. `PT2H28M7.9S` -> 8887.9). The MPD carries the
 * *true total* runtime of the source, which the transcode HLS live window does
 * not expose through `video.duration`. Returns null when the attribute is
 * absent or unparseable.
 */
export function parseMpdDuration(text: string): number | null {
  if (typeof text !== "string" || text === "") return null;
  const attr = text.match(/mediaPresentationDuration\s*=\s*["']([^"']+)["']/i);
  if (!attr) return null;
  return isoDurationToSeconds(attr[1]);
}

/**
 * Rewrite relative segment references inside a manifest so it can be played
 * from a Blob URL. `baseDir` is the absolute directory of the original source
 * (e.g. `https://host/api/proxy/{ticket}/a/dash/xxx/`); every relative
 * SegmentTemplate `init-stream$…/chunk-stream$…` reference and every
 * relative `<BaseURL>` is prefixed with it. Absolute URLs and already-rewritten
 * references are left alone.
 */
export function rewriteRelativeTo(baseDir: string, text: string): string {
  if (typeof text !== "string") return "";
  if (!baseDir || typeof baseDir !== "string") return text;
  // Segment-template media/initialization attributes whose value is a bare
  // relative path (optionally with a leading directory, e.g. "dash/xxx/init-stream$…").
  let out = text.replace(
    /(<(?:SegmentTemplate|SegmentList)\b[^>]*?\b(?:media|initialization)\s*=\s*["'])([^"']*)(["'])/gi,
    (whole, pre: string, val: string, post: string) => {
      if (
        val.startsWith("http://") ||
        val.startsWith("https://") ||
        val.startsWith("//") ||
        val.startsWith("/") ||
        val.startsWith(baseDir)
      ) {
        return whole;
      }
      return pre + baseDir + val + post;
    },
  );
  // Bare init/chunk tokens that were not covered above (defensive catch-all).
  out = out.replace(/(["'\s>])(init-stream\$|chunk-stream\$)/gi, (whole, pre: string, token: string) => {
    if (whole.startsWith(baseDir)) return whole; // impossible; guard only
    return pre + baseDir + token;
  });
  // Relative <BaseURL>text</BaseURL> contents.
  out = out.replace(/<BaseURL\b[^>]*>([\s\S]*?)<\/BaseURL>/gi, (whole, inner: string) => {
    const trimmed = inner.trim();
    if (
      !trimmed ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/") ||
      trimmed.startsWith(baseDir)
    ) {
      return whole;
    }
    return whole.replace(inner, baseDir + trimmed);
  });
  return out;
}
