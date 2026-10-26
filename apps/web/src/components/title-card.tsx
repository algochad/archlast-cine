"use client";

import Link from "next/link";
import { memo, useState } from "react";
import { Cover, mediaTypeLabel } from "@/components/cover";
import { CheckIcon, PlayIcon, PlusIcon, StarIcon } from "@/components/icons";
import { mbUrl } from "@/lib/api";
import { useMyList } from "@/lib/session";
import { titleHref } from "@/lib/title-ref";
import type { CatalogItem } from "@/lib/types";

/** "2023 · Series" — the only meta a card needs. */
function metaLine(item: CatalogItem): string {
  const parts: string[] = [];
  if (item.year) parts.push(item.year);
  parts.push(mediaTypeLabel(item.media_type));
  if (item.media_type === "series" && item.season_count && item.season_count > 0) {
    parts.push(`${item.season_count} season${item.season_count > 1 ? "s" : ""}`);
  }
  return parts.join(" · ");
}

export const TitleCard = memo(function TitleCard({
  item,
  rank,
  rating,
}: {
  item: CatalogItem;
  /** Shows a large outlined rank numeral (Top-10 style rows). */
  rank?: number;
  /** Optional 0-10 rating chip. */
  rating?: number | null;
  /** Accepted for backwards compatibility; hover previews were retired. */
  expandable?: boolean;
}) {
  const myList = useMyList();
  const [busy, setBusy] = useState(false);
  const idRef = item.id ?? null;
  const href = idRef ? titleHref(idRef.provider, idRef.value) : "#";
  const inList = idRef ? myList.has(idRef.provider, idRef.value) : false;
  // Poster URLs are absolute (catalogs) or backend-relative proxy paths.
  const posterSrc = item.poster_url
    ? item.poster_url.startsWith("/api/")
      ? mbUrl(item.poster_url)
      : item.poster_url
    : null;

  const toggleList = async () => {
    if (busy || !idRef) return;
    setBusy(true);
    try {
      await myList.toggle({
        provider: idRef.provider,
        id: idRef.value,
        title: item.title,
        poster: item.poster_url,
        mediaType: item.media_type,
        year: item.year,
      });
    } catch {
      /* anon/offline — leave the button idle */
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="group/card relative">
      <Link href={href} aria-label={item.title} className="group block rounded-[1.1rem] outline-none">
        <div className="poster aspect-[2/3] w-full overflow-hidden">
          <Cover
            src={posterSrc}
            alt={item.title}
            className="transition duration-500 ease-out group-hover:scale-[1.06]"
            sizes="(max-width: 640px) 42vw, (max-width: 1024px) 22vw, 14vw"
          />

          {/* Type badge */}
          <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/90 ring-1 ring-white/15 backdrop-blur-md">
            {mediaTypeLabel(item.media_type)}
          </span>

          {/* Hover veil + play affordance */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent opacity-70 transition duration-300 group-hover:opacity-100" />
          <span className="pointer-events-none absolute inset-0 z-10 grid place-items-center opacity-0 transition duration-300 group-hover:opacity-100">
            <span className="grid h-14 w-14 scale-90 place-items-center rounded-full bg-[linear-gradient(135deg,#4ade80,#16a34a)] text-white shadow-[0_10px_40px_rgba(34,197,94,0.6)] transition duration-300 group-hover:scale-100">
              <PlayIcon width={22} height={22} className="translate-x-px" />
            </span>
          </span>

          {rating != null && rating > 0 && (
            <span className="pointer-events-none absolute bottom-2.5 right-2.5 z-10 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-bold text-white ring-1 ring-white/10 backdrop-blur-md">
              <StarIcon width={11} height={11} className="text-gold" />
              {rating.toFixed(1)}
            </span>
          )}

          {rank != null && (
            <span
              aria-hidden="true"
              className="rank-numeral pointer-events-none absolute -bottom-1 left-1.5 z-10 select-none text-[5.2rem]"
            >
              {rank}
            </span>
          )}
        </div>

        <div className="mt-3 px-0.5">
          <h3 className="truncate text-[14px] font-semibold leading-snug text-zinc-100 transition-colors group-hover:text-white">
            {item.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{metaLine(item)}</p>
        </div>
      </Link>

      {/* Quick add — a sibling of the link, so it never nests interactive content */}
      {idRef && (
        <button
          type="button"
          onClick={() => void toggleList()}
          disabled={busy}
          aria-label={inList ? `Remove ${item.title} from My List` : `Add ${item.title} to My List`}
          aria-pressed={inList}
          className={`absolute right-2.5 top-2.5 z-20 grid h-8 w-8 place-items-center rounded-full ring-1 backdrop-blur-md transition duration-200 focus-visible:opacity-100 group-hover/card:opacity-100 sm:opacity-0 ${
            inList
              ? "bg-brand text-black opacity-100 ring-white/30"
              : "bg-black/55 text-white ring-white/20 hover:bg-white/20"
          }`}
        >
          {inList ? <CheckIcon width={15} height={15} /> : <PlusIcon width={15} height={15} />}
        </button>
      )}
    </article>
  );
});
