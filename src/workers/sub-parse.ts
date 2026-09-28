/// <reference lib="webworker" />
import { parseAssCues, parseSubtitleCues, parseTtmlCues, type SubtitleCue } from "../lib/captions";

type Req = { id: number; text: string; format?: string | null };
type Res = { id: number; cues: SubtitleCue[] };

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, text, format } = e.data;
  const lower = (format ?? "").toLowerCase();
  let cues: SubtitleCue[] = [];
  try {
    if (lower === "ass" || lower === "ssa") {
      const a = parseAssCues(text);
      cues = a.length ? a : parseSubtitleCues(text);
    } else if (lower === "ttml") {
      const tt = parseTtmlCues(text);
      cues = tt.length ? tt : parseSubtitleCues(text);
    } else {
      if (text.includes("[Script Info]") && text.includes("Dialogue:")) {
        const a = parseAssCues(text);
        if (a.length) cues = a;
        else if (text.includes("<tt") && text.includes("<p")) {
          const tt = parseTtmlCues(text);
          cues = tt.length ? tt : parseSubtitleCues(text);
        } else {
          cues = parseSubtitleCues(text);
        }
      } else if (text.includes("<tt") && text.includes("<p")) {
        const tt = parseTtmlCues(text);
        cues = tt.length ? tt : parseSubtitleCues(text);
      } else {
        cues = parseSubtitleCues(text);
      }
    }
  } catch {
    try {
      cues = parseSubtitleCues(text);
    } catch {
      cues = [];
    }
  }
  (self as unknown as { postMessage: (d: Res) => void }).postMessage({ id, cues });
};

export {};
