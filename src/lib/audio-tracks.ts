// Audio rendition choice for multi-audio HLS (e.g. Collaps masters that mark
// a Russian dub DEFAULT=YES ahead of the original English track).

/** The fields of an hls.js audio track (EXT-X-MEDIA TYPE=AUDIO) this needs. */
export interface AudioTrackLike {
  lang?: string;
  name?: string;
  default?: boolean;
}

const ALIASES: Record<string, string> = {
  eng: "en", english: "en",
  jpn: "ja", jap: "ja", japanese: "ja",
  rus: "ru", russian: "ru",
  ukr: "uk", ukrainian: "uk",
  spa: "es", spanish: "es",
  fre: "fr", fra: "fr", french: "fr",
  ger: "de", deu: "de", german: "de",
  ita: "it", italian: "it",
  kor: "ko", korean: "ko",
  chi: "zh", zho: "zh", chinese: "zh",
  por: "pt", portuguese: "pt",
  hin: "hi", hindi: "hi",
  fil: "tl", tgl: "tl", tagalog: "tl", filipino: "tl",
};

/** ISO-639-1 code for "en-US", "eng", "English" or a "eng8"-style NAME; "" when unknown. */
export function normalizeLang(raw: string | undefined | null): string {
  const letters = (raw ?? "").trim().toLowerCase().match(/^[a-z]+/)?.[0] ?? "";
  if (ALIASES[letters]) return ALIASES[letters];
  return letters.length === 2 ? letters : "";
}

function trackLang(t: AudioTrackLike): string {
  return normalizeLang(t.lang) || normalizeLang(t.name);
}

/**
 * Audio renditions (`EXT-X-MEDIA:TYPE=AUDIO`) of an HLS master, in playlist
 * order. Only the first GROUP-ID is kept: CDNs repeat the same renditions in a
 * failover group, and hls.js lists just the active level's group.
 */
export function parseHlsAudioRenditions(master: string): AudioTrackLike[] {
  let group: string | undefined;
  const out: AudioTrackLike[] = [];
  for (const line of master.split(/\r?\n/)) {
    if (!line.startsWith("#EXT-X-MEDIA:")) continue;
    const attrs: Record<string, string> = {};
    for (const m of line.slice("#EXT-X-MEDIA:".length).matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) {
      attrs[m[1]] = m[3] ?? m[2];
    }
    if (attrs.TYPE !== "AUDIO") continue;
    group ??= attrs["GROUP-ID"];
    if (attrs["GROUP-ID"] !== group) continue;
    out.push({ lang: attrs.LANGUAGE, name: attrs.NAME, default: attrs.DEFAULT === "YES" });
  }
  return out;
}

/**
 * Index of the rendition to play: the first preferred language any track
 * carries (the stream's DEFAULT wins within that language), else the stream's
 * DEFAULT, else 0. -1 for an empty list.
 */
export function pickAudioTrack(tracks: readonly AudioTrackLike[], prefs: readonly string[]): number {
  if (!tracks.length) return -1;
  for (const pref of prefs) {
    const want = normalizeLang(pref);
    if (!want) continue;
    const matches = tracks.map((t, i) => ({ t, i })).filter(({ t }) => trackLang(t) === want);
    if (matches.length) return (matches.find(({ t }) => t.default) ?? matches[0]).i;
  }
  const def = tracks.findIndex((t) => t.default);
  return def >= 0 ? def : 0;
}
