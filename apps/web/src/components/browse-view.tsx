"use client";

import { useCallback, useMemo, useState } from "react";
import { TitleCard } from "@/components/title-card";
import { TitleRow } from "@/components/title-row";
import type { BrowseMetrics, CatalogItem } from "@/lib/types";

export type BrowseKind = "movie" | "series" | "anime";

interface Row {
  key: string;
  label: string;
  items: CatalogItem[];
}

const GENRES: Record<Exclude<BrowseKind, "anime">, string[]> = {
  movie: [
    "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family",
    "Fantasy", "History", "Horror", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western",
  ],
  series: [
    "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy",
    "Horror", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western",
  ],
};

const GRID = "grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7";
const PAGE = 50;

interface BrowseResponse {
  items: CatalogItem[];
}

export function BrowseView({
  kind,
  title,
  blurb,
  rows,
  metrics,
  error,
}: {
  kind: BrowseKind;
  title: string;
  blurb: string;
  rows: Row[];
  metrics: Record<string, BrowseMetrics>;
  error: string | null;
}) {
  const genres = kind === "anime" ? [] : GENRES[kind];
  const [genre, setGenre] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const ratingOf = useMemo(() => (item: CatalogItem) => metrics[item.id.value]?.rating ?? null, [metrics]);

  const load = useCallback(
    async (g: string, skip: number) => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(
          `/api/mb/browse?type=${kind}&genre=${encodeURIComponent(g)}&skip=${skip}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as BrowseResponse;
        const next = data.items ?? [];
        setItems((prev) => {
          const seen = new Set(prev.map((i) => `${i.id.provider}:${i.id.value}`));
          return skip === 0 ? next : [...prev, ...next.filter((i) => !seen.has(`${i.id.provider}:${i.id.value}`))];
        });
        setDone(next.length < PAGE / 2);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [kind],
  );

  const pick = (g: string | null) => {
    setGenre(g);
    setItems([]);
    setDone(false);
    if (g) void load(g, 0);
  };

  return (
    <div className="page-shell pb-24 pt-28 md:pt-36">
      <header className="mb-8 max-w-2xl">
        <h1 className="display-title text-[clamp(2.4rem,5vw,4rem)]">{title}</h1>
        <p className="mt-3 text-[15px] text-zinc-400 md:text-base">{blurb}</p>
      </header>

      {genres.length > 0 && (
        <div className="scrollbar-none -mx-[var(--page-gutter)] mb-10 flex gap-2 overflow-x-auto px-[var(--page-gutter)] pb-2" role="group" aria-label="Genres">
          <button type="button" className="chip shrink-0 !px-4 !py-2 text-sm" aria-pressed={genre === null} onClick={() => pick(null)}>
            All
          </button>
          {genres.map((g) => (
            <button
              key={g}
              type="button"
              className="chip shrink-0 !px-4 !py-2 text-sm"
              aria-pressed={genre === g}
              onClick={() => pick(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="glass mx-auto max-w-xl rounded-3xl p-10 text-center">
          <h2 className="section-title text-xl">This shelf is unavailable</h2>
          <p className="mt-2 text-sm text-zinc-400">{error}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn-solid mt-6 px-7 py-3 text-sm">
            Try again
          </button>
        </div>
      )}

      {genre === null ? (
        <div className="space-y-14">
          {rows.map((row, i) => (
            <TitleRow
              key={row.key}
              label={row.label}
              items={row.items}
              ranked={i === 0 && kind !== "anime" && row.key === "trending"}
              badge={i === 0 && row.key === "trending" ? "Hot right now" : undefined}
              ratingOf={ratingOf}
            />
          ))}
        </div>
      ) : (
        <section aria-label={`${genre} ${title}`}>
          <h2 className="section-title mb-6 text-2xl">{genre}</h2>
          {items.length > 0 && (
            <div className={GRID}>
              {items.map((item) => (
                <TitleCard key={`${item.id.provider}:${item.id.value}`} item={item} />
              ))}
            </div>
          )}
          {loading && (
            <div className={`${GRID} ${items.length ? "mt-8" : ""}`}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i}>
                  <div className="skeleton aspect-[2/3] rounded-[1.1rem]" />
                  <div className="skeleton mt-3 h-3.5 w-3/4 rounded-md" />
                </div>
              ))}
            </div>
          )}
          {failed && (
            <p className="py-10 text-center text-sm text-zinc-400">
              Couldn’t load this genre.{" "}
              <button type="button" onClick={() => void load(genre, items.length)} className="font-semibold text-brand-hover hover:text-white">
                Retry
              </button>
            </p>
          )}
          {!loading && !failed && items.length === 0 && (
            <p className="py-16 text-center text-zinc-500">Nothing here yet.</p>
          )}
          {!loading && items.length > 0 && !done && (
            <div className="mt-12 flex justify-center">
              <button type="button" onClick={() => void load(genre, items.length)} className="btn-glass px-8 py-3 text-sm">
                Load more
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
