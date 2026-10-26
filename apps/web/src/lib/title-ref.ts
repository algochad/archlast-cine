// Source-agnostic title references.
//
// Viewers should never see (or share) which backend source a title came from,
// so URLs carry one opaque `ref` segment instead of `/<provider>/<id>`:
//
//   tt1375666            IMDb-keyed title
//   m-977486567826752424 numeric/alnum ids from the other catalogs
//   a-9NdrgcZjsp7HEJ5oK
//   k-inception-movie-509
//   x-<base64url>        anything else (lossless fallback)
//
// `encodeTitleRef` / `decodeTitleRef` are exact inverses for every id the
// backend can emit; the legacy `/title/<provider>/<id>` routes redirect here.

import type { ProviderId } from "@/lib/types";

export interface TitleRef {
  provider: ProviderId;
  id: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const IMDB_ID = /^tt\d{3,12}$/;
const FOURK_PATH = /^\/([A-Za-z0-9-]{1,160})\/$/;

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): string | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const PROVIDERS: readonly ProviderId[] = [
  "collaps",
  "moviebox",
  "fourkhdhub",
  "bdix_circleftp",
  "bdix_dhakaflix",
  "addons",
  "anime",
];

export function encodeTitleRef(provider: ProviderId, id: string): string {
  if (provider === "collaps" && IMDB_ID.test(id)) return id;
  if (provider === "moviebox" && SAFE_ID.test(id)) return `m-${id}`;
  if (provider === "anime" && SAFE_ID.test(id)) return `a-${id}`;
  if (provider === "fourkhdhub") {
    const slug = FOURK_PATH.exec(id)?.[1];
    if (slug) return `k-${slug}`;
  }
  return `x-${b64urlEncode(JSON.stringify([provider, id]))}`;
}

export function decodeTitleRef(raw: string): TitleRef | null {
  let ref = raw;
  try {
    ref = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (IMDB_ID.test(ref)) return { provider: "collaps", id: ref };
  const dash = ref.indexOf("-");
  if (dash !== 1) return null;
  const tag = ref[0];
  const rest = ref.slice(2);
  if (!rest) return null;
  if (tag === "m" && SAFE_ID.test(rest)) return { provider: "moviebox", id: rest };
  if (tag === "a" && SAFE_ID.test(rest)) return { provider: "anime", id: rest };
  if (tag === "k" && /^[A-Za-z0-9-]{1,160}$/.test(rest)) return { provider: "fourkhdhub", id: `/${rest}/` };
  if (tag === "x") {
    const json = b64urlDecode(rest);
    if (!json) return null;
    try {
      const parsed: unknown = JSON.parse(json);
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === "string" &&
        typeof parsed[1] === "string" &&
        parsed[1].length > 0 &&
        (PROVIDERS as readonly string[]).includes(parsed[0])
      ) {
        return { provider: parsed[0] as ProviderId, id: parsed[1] };
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

export function titleHref(provider: ProviderId | string, id: string): string {
  return `/title/${encodeTitleRef(provider as ProviderId, id)}`;
}

export function watchHref(
  provider: ProviderId | string,
  id: string,
  episode?: { season: number; episode: number } | null,
): string {
  const base = `/watch/${encodeTitleRef(provider as ProviderId, id)}`;
  return episode ? `${base}?s=${episode.season}&e=${episode.episode}` : base;
}
