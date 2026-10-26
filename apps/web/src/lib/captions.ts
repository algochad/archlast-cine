export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  settings?: { line?: string; position?: string; align?: string };
  ass?: string;
}

export type CueKind = 'dialogue' | 'sign' | 'song';

/**
 * Live handle on an attached caption track. Kept by the player so the same
 * cue set can be re-applied (source reloads, HLS live window slides, MSE
 * track drops) without re-fetching the subtitle file.
 */
export interface SubtitleTrackState {
  /** DOM TextTrack backing the captions; may be re-created on re-attach. */
  track: TextTrack | null;
  label: string;
  cues: SubtitleCue[];
  offsetMs?: number;
  source?: 'native' | 'overlay' | 'jassub';
  /** Remove every cue and hide the track (used on teardown / track switch). */
  cleanup: () => void;
}

/** Parses SRT or WebVTT text into normalized cues (times in seconds). */
export function parseSubtitleCues(source: string): SubtitleCue[] {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const body = text.startsWith("WEBVTT") ? text.replace(/^WEBVTT[^\n]*\n/, "") : text;
  const blocks = body.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx = 1;
    const timing = lines[idx];
    if (!timing || !timing.includes("-->")) continue;
    // VTT cue settings trail the end time (e.g. "00:00:02.000 align:middle position:50%")
    const arrow = timing.indexOf("-->");
    const startRaw = timing.slice(0, arrow).trim();
    const afterArrow = timing.slice(arrow + 3).trim();
    const endRaw = afterArrow.split(/\s+/)[0] ?? "";
    // optional cue settings after end time (position/line/align) — capture for overlay if needed
    const settingsStr = afterArrow.slice(endRaw.length).trim();
    const start = toSeconds(startRaw);
    const end = toSeconds(endRaw);
    if (start == null || end == null || end <= start) continue;
    const content = lines.slice(idx + 1).join("\n").trim();
    if (!content) continue;
    const cue: SubtitleCue = { start, end, text: content } as SubtitleCue;
    if (settingsStr) {
      const settings: Record<string,string> = {};
      const alignM = settingsStr.match(/align:(\w+)/i);
      const posM = settingsStr.match(/position:(\S+)/i);
      const lineM = settingsStr.match(/line:(\S+)/i);
      if (alignM) settings.align = alignM[1].toLowerCase();
      if (posM) settings.position = posM[1];
      if (lineM) settings.line = lineM[1];
      if (Object.keys(settings).length) (cue as SubtitleCue).settings = settings as SubtitleCue['settings'];
    }
    cues.push(cue);
  }
  return cues;
}

function toSeconds(raw: string): number | null {
  const match = raw.trim().replace(",", ".").match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const h = Number(match[1] ?? 0);
  const m = Number(match[2]);
  const s = Number(match[3]);
  const frac = Number(`0.${match[4] ?? "0"}`);
  return h * 3600 + m * 60 + s + frac;
}

function assTimeToSeconds(raw: string): number | null {
  // ASS: h:mm:ss.cc where cc is centiseconds (0-99), or h:mm:ss.mmm
  const t = raw.trim();
  // Accept H:MM:SS.cc , H:MM:SS.mmm , H:MM:SS
  const m = t.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const fracRaw = m[4] ?? "0";
  let frac = 0;
  if (fracRaw.length === 1) frac = Number(fracRaw) / 10;
  else if (fracRaw.length === 2) frac = Number(fracRaw) / 100;
  else frac = Number(`0.${fracRaw}`);
  return h * 3600 + min * 60 + sec + frac;
}

function stripAssTags(text: string): string {
  // Remove {…} override blocks
  let out = text.replace(/\{[^}]*\}/g, "");
  // ASS hard line breaks
  out = out.replace(/\\N/g, "\n").replace(/\\n/g, "\n").replace(/\\h/g, " ");
  // Remove any remaining escape for literal \
  out = out.replace(/\\/g, "");
  return out.trim();
}

/**
 * Parse ASS/SSA Dialogue lines into cues. Stripped dialogue text only
 * (JASSUB path for full typesetting is P4). Pure + tested.
 */
export function parseAssCues(source: string): SubtitleCue[] {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  let inEvents = false;
  let formatCols: string[] | null = null;
  const cues: SubtitleCue[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    if (line.startsWith("[Events]")) { inEvents = true; continue; }
    if (line.startsWith("[")) { if (inEvents) break; else continue; }
    if (!inEvents) continue;
    if (line.startsWith("Format:")) {
      formatCols = line.slice("Format:".length).split(",").map((s) => s.trim().toLowerCase());
      continue;
    }
    if (!line.startsWith("Dialogue:")) continue;
    const payload = line.slice("Dialogue:".length);
    // Split into up to 10 fields; Text may contain commas
    // If we have formatCols, use its length; else default 10
    const expected = formatCols ? formatCols.length : 10;
    // Use limited split: first expected-1 commas
    const parts: string[] = [];
    let cur = "";
    let commas = 0;
    for (let i = 0; i < payload.length; i++) {
      const ch = payload[i];
      if (ch === "," && commas < expected - 1) {
        parts.push(cur);
        cur = "";
        commas++;
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    if (parts.length < expected) continue;
    const map: Record<string, string> = {};
    const cols = formatCols ?? ["layer","start","end","style","name","marginl","marginr","marginv","effect","text"];
    for (let i = 0; i < cols.length; i++) map[cols[i]] = (parts[i] ?? "").trim();
    const start = assTimeToSeconds(map["start"] ?? "");
    const end = assTimeToSeconds(map["end"] ?? "");
    if (start == null || end == null || end <= start) continue;
    const rawText = map["text"] ?? "";
    const stripped = stripAssTags(rawText);
    if (!stripped) continue;
    const styleName = map["style"] ?? "";
    const cue: SubtitleCue = { start, end, text: stripped };
    if (styleName) cue.ass = styleName;
    // Keep raw stripped text; classifier uses style field
    cues.push(cue);
  }
  return cues;
}

function ttmlTimeToSeconds(raw: string): number | null {
  const t = raw.trim();
  // clock time: hh:mm:ss[.mmm] or hh:mm:ss:ms or seconds with 's'
  if (t.endsWith("s")) {
    const n = Number(t.slice(0, -1));
    if (Number.isFinite(n)) return n;
    return null;
  }
  // hh:mm:ss[.mmm]
  const m = t.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (m) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const frac = Number(`0.${m[4] ?? "0"}`);
    return h * 3600 + mm * 60 + ss + frac;
  }
  // mm:ss[.mmm]
  const m2 = t.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (m2) {
    const mm = Number(m2[1]);
    const ss = Number(m2[2]);
    const frac = Number(`0.${m2[3] ?? "0"}`);
    return mm * 60 + ss + frac;
  }
  const n = Number(t);
  if (Number.isFinite(n)) return n;
  return null;
}

/**
 * Parse TTML/DFXP <p begin dur> cues into SubtitleCues.
 * Handles begin + dur or begin + end. Ignores blocks without valid times.
 */
export function parseTtmlCues(source: string): SubtitleCue[] {
  const text = source.replace(/^\uFEFF/, "");
  const cues: SubtitleCue[] = [];
  // Match <p ...>...</p> (non-greedy inner)
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(text)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const beginM = attrs.match(/\bbegin\s*=\s*["']([^"']+)["']/i);
    if (!beginM) continue;
    const begin = ttmlTimeToSeconds(beginM[1]);
    if (begin == null) continue;
    let end: number | null = null;
    const endM = attrs.match(/\bend\s*=\s*["']([^"']+)["']/i);
    const durM = attrs.match(/\bdur\s*=\s*["']([^"']+)["']/i);
    if (endM) end = ttmlTimeToSeconds(endM[1]);
    else if (durM) {
      const dur = ttmlTimeToSeconds(durM[1]);
      if (dur != null) end = begin + dur;
    } else {
      // No dur/end — try to fallback: skip
      continue;
    }
    if (end == null || end <= begin) continue;
    // Strip inner tags: <span>, <br/> etc.
    let plain = inner.replace(/<br\s*\/?>/gi, "\n");
    plain = plain.replace(/<[^>]+>/g, "");
    plain = plain.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
    plain = plain.trim();
    if (!plain) continue;
    cues.push({ start: begin, end, text: plain });
  }
  return cues;
}

/**
 * Shift cues by ms (positive = delay, negative = advance). Clamped to >=0.
 * Pure + tested.
 */
export function shiftCues(cues: SubtitleCue[], ms: number): SubtitleCue[] {
  if (!ms) return cues.map((c) => ({ ...c }));
  const delta = ms / 1000;
  return cues.map((c) => ({
    ...c,
    start: Math.max(0, c.start + delta),
    end: Math.max(0, c.end + delta),
  })).filter((c) => c.end > c.start);
}

/**
 * Classify a cue as dialogue / sign / song for the signs-only filter.
 * Heuristic: style name or text markers. Pure + tested.
 */
export function classifyCue(text: string, style?: string): CueKind {
  const s = (style ?? "").toLowerCase();
  const t = text.trim();
  // Style-based
  if (s.includes("sign")) return 'sign';
  if (s.includes("song") || s.includes("lyric") || s === "op" || s === "ed" || s.includes("karaoke") || s.includes("music")) return 'song';
  // Text markers
  if (/^\[.*\]$/.test(t) || /^\(.*\)$/.test(t)) {
    // Bracketed descriptions often signs/SDH, but treat as sign for filter
    // Song lyrics sometimes in brackets? Prefer song detection first above.
    return 'sign';
  }
  // Common sign markers: uppercase location, or leading ♪
  if (/^[A-Z][A-Z\s]+$/.test(t) && t.length < 30) {
    // Could be sign, but conservative: keep dialogue unless style says sign
  }
  if (/^[♪♫]/.test(t) || /♪/.test(t)) return 'song';
  // Italic-only lyric heuristic not available without style — keep dialogue
  return 'dialogue';
}

// Safari (pre-VTTCue) exposes a TextTrackCue constructor that accepts
// (start, end, text) — the TS DOM model only declares a no-arg form, so the
// runtime signature is described explicitly here.
type LegacyCueCtor = new (start: number, end: number, text: string) => TextTrackCue;

function addCueCompat(track: TextTrack, cue: SubtitleCue): void {
  try {
    if (typeof VTTCue !== "undefined") {
      const vtt = new VTTCue(cue.start, cue.end, cue.text);
      // Apply optional cue settings if present (line/position/align)
      if (cue.settings) {
        if (cue.settings.line != null) {
          try { (vtt as unknown as { line: unknown }).line = cue.settings.line as unknown; } catch {}
        }
        if (cue.settings.position != null) {
          try { (vtt as unknown as { position: unknown }).position = Number(cue.settings.position); } catch {}
        }
        if (cue.settings.align != null) {
          try { (vtt as unknown as { align: unknown }).align = cue.settings.align as unknown; } catch {}
        }
      }
      track.addCue(vtt);
    } else if (typeof TextTrackCue !== "undefined") {
      const Ctor = TextTrackCue as unknown as LegacyCueCtor;
      track.addCue(new Ctor(cue.start, cue.end, cue.text));
    }
  } catch {
    /* skip malformed cue */
  }
}

/**
 * Adds cues to a track. Callers guarantee the track has no cues yet, so
 * re-attach stays idempotent without having to read DOM cue objects back.
 */
function addAllCues(track: TextTrack, cues: SubtitleCue[]): void {
  for (const cue of cues) addCueCompat(track, cue);
}

function findTrack(video: HTMLVideoElement, label: string): TextTrack | null {
  for (const t of video.textTracks) {
    if (t.kind === "subtitles" && t.label === label) return t;
  }
  return null;
}

/**
 * Attaches external cues to a video element as a rendered text track.
 * Works for both native playback and MSE-based players (dash.js / hls.js).
 *
 * Ordering matters in Chromium: the track must be in `showing` mode only
 * AFTER its cues exist, otherwise the cue engine never picks them up (the
 * classic "track attached but nothing renders" bug).
 */
export function attachSubtitleTrack(
  video: HTMLVideoElement,
  label: string,
  cues: SubtitleCue[],
  opts?: { offsetMs?: number; source?: SubtitleTrackState['source'] },
): SubtitleTrackState {
  const offsetMs = opts?.offsetMs ?? 0;
  const source = opts?.source ?? 'native';
  const shifted = offsetMs ? shiftCues(cues, offsetMs) : cues;
  const state: SubtitleTrackState = {
    track: null,
    label,
    cues: [...cues],
    offsetMs,
    source,
    cleanup: () => {
      const track = state.track;
      state.track = null;
      if (!track) return;
      try {
        for (const cue of Array.from(track.cues ?? [])) track.removeCue(cue);
        track.mode = "disabled";
      } catch {
        /* ignore */
      }
    },
  };
  // Reuse an existing matching track (re-attach after a source switch) rather
  // than stacking a second one on the same element.
  const existing = findTrack(video, label);
  const track = existing ?? video.addTextTrack("subtitles", label, "en");
  state.track = track;
  if (existing) {
    if (!track.cues || track.cues.length === 0) addAllCues(track, shifted);
  } else {
    addAllCues(track, shifted);
  }
  try {
    track.mode = "showing"; // only after cues exist
  } catch {
    /* ignore */
  }
  return state;
}

/**
 * Re-applies a previously attached track after the source (re)started.
 * Cheap by design: re-adding cached cues (with offset) and re-asserting `showing` only when
 * the DOM track lost them. HLS/dash source switches, and Chrome's cue engine
 * after MSE reloads, can silently drop the track or stop matching cues; this
 * restores it without re-fetching the subtitle text.
 */
export function reattachSubtitleTrack(
  video: HTMLVideoElement,
  state: SubtitleTrackState | null,
): void {
  if (!state) return;
  let track = state.track;
  const stillAttached = track != null && Array.from(video.textTracks).includes(track);
  const shifted = state.offsetMs ? shiftCues(state.cues, state.offsetMs) : state.cues;
  if (!stillAttached) {
    track = findTrack(video, state.label) ?? video.addTextTrack("subtitles", state.label, "en");
    state.track = track;
    if (!track.cues || track.cues.length === 0) addAllCues(track, shifted);
  } else if (track && (!track.cues || track.cues.length === 0)) {
    addAllCues(track, shifted);
  }
  if (track) {
    try {
      track.mode = "showing";
    } catch {
      /* ignore */
    }
  }
  // Chromium re-evaluates active cues on the next media update; re-assert the
  // mode a frame later so a cue covering the current time starts rendering
  // right after a source switch/seek restart.
  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      if (!state.track) return;
      try {
        state.track.mode = "showing";
      } catch {
        /* ignore */
      }
    });
  }
}

/**
 * Ensures a shown caption track still matches the current playhead. Call
 * after seeks and periodically while captions are on: if cues exist for the
 * current time but the browser reports none active (a known MSE/HLS quirk),
 * re-adding the cue list forces the engine to re-run its matcher.
 */
export function ensureActiveCues(
  video: HTMLVideoElement,
  state: SubtitleTrackState | null,
): void {
  if (!state || !state.track) return;
  const track = state.track;
  try {
    if (track.mode !== "showing") track.mode = "showing";
  } catch {
    return;
  }
  const shifted = state.offsetMs ? shiftCues(state.cues, state.offsetMs) : state.cues;
  if (!track.cues || track.cues.length === 0) {
    addAllCues(track, shifted);
    return;
  }
  const t = video.currentTime;
  const shouldHaveCue = shifted.some((c) => t >= c.start && t < c.end);
  if (!shouldHaveCue) return;
  if (track.activeCues && track.activeCues.length > 0) return;
  // Stale matcher: refresh the cue list so the browser re-matches currentTime.
  const cues = Array.from(track.cues);
  try {
    for (const cue of cues) track.removeCue(cue);
    addAllCues(track, shifted);
  } catch {
    /* ignore */
  }
}
