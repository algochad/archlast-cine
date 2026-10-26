"use client";

import { useMemo, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { groupSubtitles } from "@/lib/sub-menu";
import type { SubtitleOption } from "@/lib/types";

/**
 * Language-grouped track picker for the player's CC menu. Renders `<li>` rows
 * (the caller owns the `<ul>`). Source-agnostic: shows language + flavour only.
 */
export function SubtitleList({
  options,
  chosenUrl,
  prefLangs,
  onChoose,
}: {
  options: SubtitleOption[];
  chosenUrl: string | null;
  prefLangs: string[];
  onChoose: (opt: SubtitleOption) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupSubtitles(options, prefLangs), [options, prefLangs]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? groups.filter((g) => g.label.toLowerCase().includes(q) || g.code.startsWith(q)) : groups;
  }, [groups, query]);

  return (
    <>
      {groups.length > 8 && (
        <li className="hairline-t px-3 py-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={`Search ${groups.length} languages`}
            aria-label="Filter subtitle languages"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-brand/60"
          />
        </li>
      )}
      {shown.length === 0 && <li className="hairline-t px-3 py-3 text-xs text-zinc-500">No language matches “{query}”.</li>}
      {shown.map((group) => (
        <li key={group.code} className="hairline-t">
          <p className="flex items-center gap-2 px-3 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            {group.label}
            {group.preferred && <span className="rounded-full bg-brand/20 px-1.5 py-px text-[9px] text-brand-hover">Yours</span>}
          </p>
          <ul>
            {group.tracks.map(({ opt, label }) => {
              const active = chosenUrl === opt.url;
              return (
                <li key={`${opt.url}:${label}`}>
                  <button
                    type="button"
                    onClick={() => onChoose(opt)}
                    aria-pressed={active}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition hover:bg-white/10 ${
                      active ? "text-brand-hover" : "text-zinc-200"
                    }`}
                  >
                    <span className="truncate">{label}</span>
                    {active && <CheckIcon width={14} height={14} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </>
  );
}
