"use client";

import { useEffect, useMemo, useState } from "react";
import { ContinueCard } from "@/components/continue-card";
import { Hero, type HeroSlide } from "@/components/hero";
import { TitleRow } from "@/components/title-row";
import type { WatchEntry } from "@/lib/account";
import { getHistory } from "@/lib/history";
import { mergeEntries } from "@/lib/history-merge";
import { buildMetricRows, buildTypeRows, metricOf } from "@/lib/rows";
import { useServerHistory } from "@/lib/session";
import type { BrowseMetrics, CatalogItem, HomeResponse } from "@/lib/types";

interface FeedProps {
  feed: CatalogItem[] | null;
  metrics: Record<string, BrowseMetrics>;
  slides: HeroSlide[];
  error: string | null;
}

/** A row is "done" once the player has passed ~98% of a known duration. */
function unfinished(entries: WatchEntry[]): WatchEntry[] {
  return entries.filter((e) => !(e.duration > 0 && e.position / e.duration > 0.98));
}

const ROW_BADGE: Record<string, string> = { trending: "Hot right now" };

export function HomeFeed({ feed, metrics, slides, error }: FeedProps) {
  const server = useServerHistory();
  const [local, setLocal] = useState<WatchEntry[]>([]);
  const [localReady, setLocalReady] = useState(false);
  const [animeItems, setAnimeItems] = useState<CatalogItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mb/anime/trending")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: HomeResponse) => {
        if (!cancelled) setAnimeItems(data.items ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Anonymous / offline history mirrored into the account shape (updatedAt).
    setLocal(getHistory().map((e): WatchEntry => ({ ...e, updatedAt: e.updated })));
    setLocalReady(true);
  }, []);

  // Server history is canonical when signed in; local rows fill whatever the
  // server has not seen yet (pre-login / just-recorded progress).
  const history = useMemo(() => unfinished(mergeEntries(server.entries, local)), [server.entries, local]);
  const ready = localReady && server.ready;

  const metricRows = useMemo(() => (feed ? buildMetricRows(feed, metrics) : []), [feed, metrics]);
  const typeRows = useMemo(() => (feed ? buildTypeRows(feed, metrics) : []), [feed, metrics]);
  const ratingOf = useMemo(
    () => (item: CatalogItem) => metricOf(item, metrics).rating ?? null,
    [metrics],
  );

  if (error || !feed) {
    return (
      <div className="page-shell flex min-h-[80vh] flex-col items-center justify-center gap-5 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-3xl ring-1 ring-brand/40">📡</span>
        <h1 className="display-title text-4xl">We can’t reach the library</h1>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          {error ?? "The media service did not respond."} Give it a moment and try again.
        </p>
        <button onClick={() => window.location.reload()} className="btn-solid px-8 py-3 text-sm">
          Try again
        </button>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="page-shell flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="display-title text-3xl">The shelf is empty</h1>
        <p className="text-sm text-zinc-500">No titles are available right now — check back shortly.</p>
      </div>
    );
  }

  const hasContinue = ready && history.length > 0;

  return (
    <div>
      <Hero slides={slides} />

      {/* The feed overlaps the hero's bottom fade for a seamless transition */}
      <div className="page-shell relative z-10 -mt-14 space-y-14 pb-10 md:-mt-20">
        {hasContinue && (
          <section aria-label="Continue Watching">
            <h2 className="section-title mb-5 text-[1.4rem] md:text-[1.65rem]">Continue watching</h2>
            <div
              className="scrollbar-none -mx-[var(--page-gutter)] flex snap-x gap-4 overflow-x-auto px-[var(--page-gutter)] pb-3 md:gap-5"
              style={{ scrollPaddingInline: "var(--page-gutter)" }}
            >
              {history.map((entry) => (
                <ContinueCard key={`${entry.provider}:${entry.id}:${entry.season}:${entry.episode}`} entry={entry} />
              ))}
            </div>
          </section>
        )}

        {metricRows.map((row) => {
          const ranked = row.key === "trending";
          return (
            <TitleRow
              key={row.key}
              label={row.label}
              items={ranked ? row.items.slice(0, 10) : row.items}
              badge={ROW_BADGE[row.key]}
              ranked={ranked}
              ratingOf={ranked ? undefined : ratingOf}
            />
          );
        })}
        {typeRows.map((row) => (
          <TitleRow key={row.key} label={row.label} items={row.items} ratingOf={ratingOf} />
        ))}
        {animeItems.length > 0 && <TitleRow key="trending-anime" label="Trending anime" items={animeItems} />}
      </div>
    </div>
  );
}
