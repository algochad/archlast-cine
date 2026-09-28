/**
 * Thumbnail sprite VTT helpers.
 * Pure functions — safe for SSR and unit tests.
 */

export interface ThumbCue {
  start: number;
  end: number;
  /** e.g. "sprite-0.jpg" (relative to thumbs.vtt dir) */
  sprite: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Parse a WebVTT timestamp to seconds.
 * Accepts "HH:MM:SS.mmm" or "MM:SS.mmm" (or without ms).
 * Returns null when unparseable.
 */
export function parseVttTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  try {
    if (parts.length === 2) {
      const m = Number(parts[0]);
      const secParts = parts[1].split(".");
      const sec = Number(secParts[0]);
      const ms = secParts[1] ? Number(`0.${secParts[1]}`) : 0;
      if (!Number.isFinite(m) || !Number.isFinite(sec) || !Number.isFinite(ms)) return null;
      if (m < 0 || sec < 0 || sec >= 60) return null;
      return m * 60 + sec + ms;
    }
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const secParts = parts[2].split(".");
    const sec = Number(secParts[0]);
    const ms = secParts[1] ? Number(`0.${secParts[1]}`) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(sec) || !Number.isFinite(ms)) return null;
    if (h < 0 || m < 0 || m >= 60 || sec < 0 || sec >= 60) return null;
    return h * 3600 + m * 60 + sec + ms;
  } catch {
    return null;
  }
}

/**
 * Parse a thumbs.vtt file into a sorted array of cues.
 * Each cue payload is expected to be `sprite-N.jpg#xywh=x,y,w,h`
 * Counter-tolerant: skips WEBVTT header and empty lines, tolerates
 * trailing spaces and Windows line endings.
 */
export function parseThumbsVtt(text: string): ThumbCue[] {
  if (!text || typeof text !== "string") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cues: ThumbCue[] = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trim();
    // Skip WEBVTT header and NOTE/comments and empty
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || line.startsWith("STYLE")) {
      i++;
      continue;
    }
    // Look for timestamp line: "00:00.000 --> 00:10.000"
    const arrow = line.indexOf("-->");
    if (arrow === -1) {
      i++;
      continue;
    }
    const left = line.slice(0, arrow).trim();
    const right = line.slice(arrow + 3).trim().split(/\s+/)[0];
    const start = parseVttTime(left);
    const end = parseVttTime(right);
    if (start == null || end == null) {
      i++;
      continue;
    }
    // Next non-empty line is payload
    let payload = "";
    let j = i + 1;
    while (j < lines.length) {
      const cand = lines[j].trim();
      if (cand) {
        payload = cand;
        break;
      }
      j++;
    }
    if (!payload) {
      i++;
      continue;
    }
    // Payload: "sprite-0.jpg#xywh=0,0,160,90"
    let sprite = payload;
    let x = 0, y = 0, w = 160, h = 90;
    const hashIdx = payload.indexOf("#xywh=");
    if (hashIdx !== -1) {
      sprite = payload.slice(0, hashIdx).trim();
      const xywh = payload.slice(hashIdx + 6).trim().split(",").map(Number);
      if (xywh.length === 4 && xywh.every((n) => Number.isFinite(n))) {
        [x, y, w, h] = xywh;
      }
    } else {
      sprite = payload.trim();
    }
    if (sprite) {
      cues.push({ start, end, sprite, x, y, w, h });
    }
    i = j + 1;
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/**
 * Find the thumb covering `time` seconds.
 * Returns null when no cue covers the time.
 */
export function findThumb(cues: ThumbCue[], time: number): ThumbCue | null {
  if (!cues.length || !Number.isFinite(time) || time < 0) return null;
  // Binary search (cues sorted by start)
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (time < c.start) hi = mid - 1;
    else if (time >= c.end) lo = mid + 1;
    else return c;
  }
  // If time beyond last cue end but within duration, return last cue (last frame)
  const last = cues[cues.length - 1];
  if (time >= last.end && time < last.end + 10) return last;
  return null;
}
