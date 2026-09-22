export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

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
    // Skip numeric SRT sequence ids.
    if (/^\d+$/.test(lines[0].trim())) idx = 1;
    const timing = lines[idx];
    if (!timing || !timing.includes("-->")) continue;
    const [startRaw, endRaw] = timing.split("-->");
    const start = toSeconds(startRaw);
    const end = toSeconds(endRaw);
    if (start == null || end == null || end <= start) continue;
    const content = lines.slice(idx + 1).join("\n").trim();
    if (content) cues.push({ start, end, text: content });
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

// Safari (pre-VTTCue) exposes a TextTrackCue constructor that accepts
// (start, end, text) — the TS DOM model only declares a no-arg form, so the
// runtime signature is described explicitly here.
type LegacyCueCtor = new (start: number, end: number, text: string) => TextTrackCue;

function addCueCompat(track: TextTrack, cue: SubtitleCue): void {
  try {
    if (typeof VTTCue !== "undefined") {
      track.addCue(new VTTCue(cue.start, cue.end, cue.text));
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
): SubtitleTrackState {
  const state: SubtitleTrackState = {
    track: null,
    label,
    cues: [...cues],
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
    if (!track.cues || track.cues.length === 0) addAllCues(track, cues);
  } else {
    addAllCues(track, cues);
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
 * Cheap by design: re-adding cached cues and re-asserting `showing` only when
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
  if (!stillAttached) {
    track = findTrack(video, state.label) ?? video.addTextTrack("subtitles", state.label, "en");
    state.track = track;
    if (!track.cues || track.cues.length === 0) addAllCues(track, state.cues);
  } else if (track && (!track.cues || track.cues.length === 0)) {
    addAllCues(track, state.cues);
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
  if (!track.cues || track.cues.length === 0) {
    addAllCues(track, state.cues);
    return;
  }
  const t = video.currentTime;
  const shouldHaveCue = state.cues.some((c) => t >= c.start && t < c.end);
  if (!shouldHaveCue) return;
  if (track.activeCues && track.activeCues.length > 0) return;
  // Stale matcher: refresh the cue list so the browser re-matches currentTime.
  const cues = Array.from(track.cues);
  try {
    for (const cue of cues) track.removeCue(cue);
    addAllCues(track, state.cues);
  } catch {
    /* ignore */
  }
}
