"use client";

import Link from "next/link";
import { useState } from "react";
import { Cover } from "@/components/cover";
import { CheckIcon, InfoIcon, PlayIcon } from "@/components/icons";
import { useMyList } from "@/lib/session";
import type { CatalogItem } from "@/lib/types";

const SCREENING_LABEL: Record<string, string> = {
  series: "ARCHLAST CINE ORIGINAL · SERIES SCREENING",
  movie: "ARCHLAST CINE ORIGINAL · FILM SCREENING",
};

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      width={17}
      height={17}
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function Billboard({
  item,
  metrics,
  playing,
  onPlay,
}: {
  item: CatalogItem;
  metrics?: { rating: number | null; trending: number | null };
  playing: boolean;
  onPlay: () => void;
}) {
  const myList = useMyList();
  const [savingList, setSavingList] = useState(false);
  const saved = myList.has(item.id.provider, item.id.value);
  const year = item.year ?? null;
  const rating = metrics?.rating != null ? metrics.rating : null;
  const trending = metrics?.trending != null ? metrics.trending : null;

  const metaParts = [
    year ?? null,
    rating != null ? `${rating.toFixed(1)}★` : null,
    trending != null ? `#${Math.round(trending)} TRENDING` : null,
  ].filter((x): x is string => x != null);

  return (
    <section className="relative w-full overflow-hidden">
      {/* Background: soft-blurred poster keeps the hero legible at any size */}
      <div className="absolute inset-0 scale-110">
        <Cover
          src={item.poster_url}
          alt=""
          className="object-cover blur-3xl saturate-[1.2] opacity-50"
          sizes="100vw"
          priority
        />
      </div>
      {/* Editorial scrims: carbon wash left, docked gradient bottom */}
      <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-ink/30" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-ink/70" />
      {/* Subtle signal-green radial tint, top-right */}
      <div className="pointer-events-none absolute -right-32 -top-32 h-[520px] w-[520px] rounded-full bg-brand/[0.07] blur-3xl" />
      {/* Green top hairline glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent shadow-[0_0_14px_rgba(34,197,94,0.45)]" />

      <div className="relative z-10 mx-auto flex min-h-[560px] w-full max-w-[1560px] flex-col justify-end px-5 pb-36 md:min-h-[660px] md:px-8 xl:px-12">
        <div className="animate-fade-up max-w-3xl">
          {/* Eyebrow row: blinking green rec dot + screening label */}
          <p className="eyebrow mb-5 flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
            </span>
            {SCREENING_LABEL[item.media_type] ?? SCREENING_LABEL.movie}
          </p>

          <h1 className="display-title text-balance text-[clamp(2.6rem,6vw,5.5rem)]">
            {item.title}
          </h1>

          {/* Mono meta strip */}
          {metaParts.length > 0 && (
            <p className="mono-meta mt-5 text-[12px] uppercase tracking-[0.16em] text-zinc-400">
              {metaParts.map((part, i) => (
                <span key={part}>
                  {i > 0 && <span className="mx-2 text-zinc-600">·</span>}
                  <span className={part.endsWith("★") ? "text-brand" : ""}>{part}</span>
                </span>
              ))}
            </p>
          )}

          {/* CTA row */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={onPlay}
              disabled={playing}
              aria-label={`Play ${item.title}`}
              className="btn-solid mono-meta px-7 py-3 text-[13px] font-bold uppercase tracking-[0.14em] disabled:cursor-default disabled:opacity-70"
            >
              <PlayIcon width={15} height={15} className="translate-x-px" />
              {playing ? "Buffering…" : "Play"}
            </button>
            <Link
              href={`/title/${item.id.provider}/${item.id.value}`}
              className="btn-glass mono-meta px-6 py-3 text-[13px] font-semibold uppercase tracking-[0.14em]"
            >
              <InfoIcon width={15} height={15} />
              Details
            </Link>
            <button
              onClick={() => {
                if (savingList) return;
                setSavingList(true);
                void myList
                  .toggle({
                    provider: item.id.provider,
                    id: item.id.value,
                    title: item.title,
                    poster: item.poster_url,
                    mediaType: item.media_type,
                    year: item.year,
                  })
                  .catch(() => {
                    /* anon/offline — leave the state untouched */
                  })
                  .finally(() => setSavingList(false));
              }}
              disabled={savingList}
              aria-label={saved ? "Remove from My List" : "Add to My List"}
              aria-pressed={saved}
              title={saved ? "Remove from My List" : "Add to My List"}
              className={`btn-glass h-11 w-11 items-center justify-center rounded-full p-0 ${
                saved ? "bg-brand/15 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.45)]" : ""
              }`}
            >
              {saved ? (
                <CheckIcon width={17} height={17} className="text-brand" />
              ) : (
                <PlusIcon />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom polish: docked gradient + green hairline seam above the feed overlap */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-ink via-ink/90 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-[104px] h-px bg-gradient-to-r from-brand/50 via-brand/25 to-transparent" />
    </section>
  );
}
