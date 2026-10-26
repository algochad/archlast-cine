// Subtitle selection logic shared by the player's CC menu and auto-select.
// Pure and source-agnostic: tracks arrive from many origins (stream manifests,
// provider captions, subtitle search, local files) with inconsistent labels,
// so everything here keys off normalized language codes and flags.

import { normalizeLang } from "@/lib/audio-tracks";
import { isKnownLanguage, languageLabel, plainLanguageName } from "@/lib/languages";
import type { SubtitleOption } from "@/lib/types";

/** Base ISO-639-1 code of a track ("pt-BR" → "pt"), or "" when unknown. */
export function subtitleLanguage(opt: Pick<SubtitleOption, "language" | "name">): string {
  return normalizeLang(opt.language) || normalizeLang(opt.name);
}

function region(opt: Pick<SubtitleOption, "language">): string {
  const m = /^[a-z]{2,3}[-_]([a-z]{2})$/i.exec((opt.language ?? "").trim());
  return m ? m[1].toUpperCase() : "";
}

export interface SubtitleTrack {
  opt: SubtitleOption;
  /** "Standard", "SDH", "Forced", with " · 2" for repeats and "(BR)" for regional variants. */
  label: string;
}

export interface SubtitleGroup {
  code: string;
  label: string;
  /** True when the viewer listed this language in their preferences. */
  preferred: boolean;
  tracks: SubtitleTrack[];
}

/**
 * Group tracks by language: preferred languages first (in preference order),
 * then English, then everything else alphabetically; unknown-language tracks
 * (local files, odd manifests) last under "Other".
 */
export function groupSubtitles(options: readonly SubtitleOption[], prefLangs: readonly string[]): SubtitleGroup[] {
  const prefs = prefLangs.map((l) => normalizeLang(l)).filter(Boolean);
  const byCode = new Map<string, SubtitleOption[]>();
  for (const opt of options) {
    const code = subtitleLanguage(opt) || "und";
    const list = byCode.get(code);
    if (list) list.push(opt);
    else byCode.set(code, [opt]);
  }

  const rank = (code: string): number => {
    if (code === "und") return 10_000;
    const p = prefs.indexOf(code);
    if (p >= 0) return p;
    return code === "en" ? prefs.length : prefs.length + 1;
  };

  const groups: SubtitleGroup[] = [...byCode.entries()].map(([code, opts]) => {
    const seen = new Map<string, number>();
    const tracks = opts.map((opt) => {
      const base = opt.forced ? "Forced" : opt.sdh ? "SDH" : "Standard";
      const reg = region(opt);
      const key = `${base}${reg ? ` (${reg})` : ""}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { opt, label: n > 1 ? `${key} · ${n}` : key };
    });
    // Within a language: full tracks first, then SDH, then forced.
    const weight = (o: SubtitleOption) => (o.forced ? 2 : o.sdh ? 1 : 0);
    tracks.sort((a, b) => weight(a.opt) - weight(b.opt));
    const named = code === "und" || isKnownLanguage(code) ? "" : plainLanguageName(opts[0].name);
    return {
      code,
      label: code === "und" ? "Other" : named || languageLabel(code),
      preferred: prefs.includes(code),
      tracks,
    };
  });

  return groups.sort((a, b) => rank(a.code) - rank(b.code) || a.label.localeCompare(b.label));
}

export interface AutoSubtitlePrefs {
  /** Preferred languages, most wanted first. */
  langs: readonly string[];
  /** Prefer hearing-impaired (SDH) tracks when a language has them. */
  preferSDH?: boolean;
}

/**
 * The track to turn on automatically: the first preferred language that has
 * any track (a full track beats forced-only, SDH is a preference), else
 * English, else the first full track. `null` for an empty list.
 */
export function pickAutoSubtitle(options: readonly SubtitleOption[], prefs: AutoSubtitlePrefs): SubtitleOption | null {
  if (!options.length) return null;
  const choose = (pool: SubtitleOption[]): SubtitleOption => {
    const full = pool.filter((o) => !o.forced);
    const base = full.length ? full : pool;
    const sdh = base.filter((o) => !!o.sdh === !!prefs.preferSDH);
    return (sdh.length ? sdh : base)[0];
  };
  const wanted = [...prefs.langs.map((l) => normalizeLang(l)).filter(Boolean), "en"];
  for (const want of wanted) {
    const pool = options.filter((o) => subtitleLanguage(o) === want);
    if (pool.length) return choose(pool);
  }
  return choose([...options]);
}
