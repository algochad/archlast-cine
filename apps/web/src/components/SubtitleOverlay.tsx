"use client";

import type { SubtitleCue } from "@/lib/captions";
import { classifyCue } from "@/lib/captions";
import { styleToCss } from "@/lib/sub-style";
import type { SubStyle } from "@/lib/sub-style";

interface Props {
  cues: SubtitleCue[];
  style: SubStyle;
  slot: 'bottom' | 'top';
  currentTime: number;
  offsetMs: number;
  filter?: 'all' | 'signs';
  interactive?: boolean;
  onWordClick?: (word: string, cueText: string) => void;
}

function tokenize(text: string): string[] {
  // Split on whitespace, keep punctuation attached to token; simple word segmentation.
  const parts = text.split(/\s+/).filter(Boolean);
  return parts;
}

export function SubtitleOverlay({ cues, style, slot, currentTime, offsetMs, filter = 'all', interactive, onWordClick }: Props) {
  const delta = offsetMs / 1000;
  // Active cues where shifted window contains currentTime
  const active = cues.filter((c) => {
    const s = c.start + delta;
    const e = c.end + delta;
    if (currentTime < s || currentTime >= e) return false;
    if (filter !== 'all') {
      const kind = classifyCue(c.text, c.ass);
      if (filter === 'signs' && kind !== 'sign' && kind !== 'song') return false;
    }
    return true;
  });

  if (active.length === 0) return null;

  const slotStyle: React.CSSProperties = slot === 'bottom'
    ? { bottom: '8%', top: 'auto' }
    : { top: '8%', bottom: 'auto' };

  const css = styleToCss(style);
  const interactiveEnabled = Boolean(interactive && onWordClick);

  return (
    <div
      data-testid={`subtitle-overlay-${slot}`}
      aria-live="off"
      aria-atomic={false}
      className={`absolute inset-x-0 z-[18] flex flex-col items-center gap-1 px-[6%] text-center ${interactiveEnabled ? "pointer-events-auto" : "pointer-events-none"}`}
      style={slotStyle}
    >
      {active.map((cue, idx) => {
        if (!interactiveEnabled) {
          return (
            <div
              key={`${cue.start}-${idx}`}
              className="max-w-[92%] whitespace-pre-wrap break-words leading-[1.35]"
              style={css}
            >
              {cue.text}
            </div>
          );
        }
        const tokens = tokenize(cue.text);
        return (
          <div
            key={`${cue.start}-${idx}`}
            className="max-w-[92%] whitespace-pre-wrap break-words leading-[1.35]"
            style={css}
          >
            {tokens.map((tok, ti) => (
              <span
                key={`${ti}-${tok}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onWordClick?.(tok, cue.text);
                }}
                className="cursor-pointer rounded-[2px] px-0.5 transition hover:bg-white/20 hover:text-brand"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onWordClick?.(tok, cue.text);
                  }
                }}
              >
                {tok}
                {ti < tokens.length - 1 ? " " : ""}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
