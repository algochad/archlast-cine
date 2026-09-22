"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Billboard } from "@/components/billboard";
import { PlayIcon } from "@/components/icons";
import { TitleRow } from "@/components/title-row";
import { getHistory } from "@/lib/history";
import { mergeEntries } from "@/lib/history-merge";
import { useServerHistory } from "@/lib/session";
import type { WatchEntry } from "@/lib/account";
import { buildMetricRows, buildTypeRows, metricOf, pickHero } from "@/lib/rows";
import type { BrowseMetrics, CatalogItem, HomeResponse, MangaTrendingResponse } from "@/lib/types";

interface FeedProps {
  feed: CatalogItem[] | null;
  metrics: Record<string, BrowseMetrics>;
  error: string | null;
}

/** A row is "done" once the player has passed ~98% of a known duration. */
function unfinished(entries: WatchEntry[]): WatchEntry[] {
  return entries.filter((e) => !(e.duration > 0 && e.position / e.duration > 0.98));
}

export function HomeFeed({ feed, metrics, error }: FeedProps) {
  const server = useServerHistory();
  const [local, setLocal] = useState<WatchEntry[]>([]);
  const [localReady, setLocalReady] = useState(false);
  const [animeItems, setAnimeItems] = useState<CatalogItem[]>([]);
  const [mangaItems, setMangaItems] = useState<CatalogItem[]>([]);

  // Trending Anime row: fetched from the anime provider alongside the
  // server-rendered movie/series feed.
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

  // Trending Manga row: MangaScrapper catalog via the Rust backend. Degrades
  // to an absent row when the manga stack is down (dev without compose).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/mb/manga/trending")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: MangaTrendingResponse) => {
        if (!cancelled) setMangaItems(data.items ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Anonymous / offline history mirrored into the account shape (updatedAt).
    setLocal(
      getHistory().map((e): WatchEntry => ({ ...e, updatedAt: e.updated })),
    );
    setLocalReady(true);
  }, []);

  // Server history is canonical when signed in; local rows fill whatever the
  // server has not seen yet (pre-login / just-recorded progress).
  const history = useMemo(
    () => unfinished(mergeEntries(server.entries, local)),
    [server.entries, local],
  );
  const ready = localReady && server.ready;

  if (error || !feed) {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center gap-5 px-6 text-center">
        <p className="mono-meta text-[11px] font-bold tracking-[0.3em] text-brand">// SIGNAL LOST</p>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">Backend not reachable</h1>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          {error ?? "The Archlast Cine Rust backend did not respond."} Start it with{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-zinc-300">npm run dev</code>{" "}
          (launches both servers) or{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-zinc-300">npm run backend</code>
          , then reload.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn-solid mono-meta px-6 py-2.5 text-[12px] font-bold uppercase tracking-[0.14em]"
        >
          Retry
        </button>
      </div>
    );
  }

  const hero = pickHero(feed, metrics);
  const metricRows = buildMetricRows(feed, metrics);
  const typeRows = buildTypeRows(feed, metrics);

  if (!hero) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="mono-meta text-[11px] font-bold tracking-[0.3em] text-brand">// EMPTY SHELF</p>
        <p className="text-sm text-zinc-500">No titles available right now — check back after the catalog syncs.</p>
      </div>
    );
  }

  const heroMetrics = metricOf(hero, metrics);
  const hasContinue = ready && history.length > 0;

  return (
    <div>
      <Billboard
        item={hero}
        metrics={{ rating: heroMetrics.rating ?? null, trending: heroMetrics.trending ?? null }}
        playing={false}
        onPlay={() =>
          window.location.assign(`/watch/${hero.id.provider}/${hero.id.value}`)
        }
      />

      {/* Feed docks over the hero fade; gutters match the hero column exactly */}
      <div className="relative z-10 mx-auto -mt-24 w-full max-w-[1560px] space-y-12 px-5 pb-28 md:-mt-16 md:px-8 xl:px-12">
        {hasContinue && (
          <section aria-label="Continue Watching">
            <header className="mb-4 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="mono-meta text-[11px] font-bold tracking-[0.16em] text-brand"
              >
                01
              </span>
              <h2 className="shrink-0 text-lg font-extrabold tracking-tight text-zinc-50">
                Continue Watching
              </h2>
              <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-line" />
            </header>
            <div className="scrollbar-none flex gap-3 overflow-x-auto pb-1">
              {history.map((entry) => (
                <WatchCard key={entryKey(entry)} entry={entry} />
              ))}
            </div>
          </section>
        )}

        {metricRows.map((row, i) => (
          <TitleRow
            key={row.key}
            label={row.label}
            items={row.items}
            index={i + 1 + (hasContinue ? 1 : 0)}
          />
        ))}
        {typeRows.map((row, i) => (
          <TitleRow
            key={row.key}
            label={row.label}
            items={row.items}
            index={metricRows.length + i + 1 + (hasContinue ? 1 : 0)}
          />
        ))}
        {animeItems.length > 0 && (
          <TitleRow
            key="trending-anime"
            label="Trending Anime"
            items={animeItems}
            index={metricRows.length + typeRows.length + 1 + (hasContinue ? 1 : 0)}
          />
        )}
        {mangaItems.length > 0 && (
          <TitleRow
            key="trending-manga"
            label="Trending Manga"
            items={mangaItems}
            index={metricRows.length + typeRows.length + (animeItems.length > 0 ? 2 : 1) + (hasContinue ? 1 : 0)}
          />
        )}
      </div>
    </div>
  );
}

function entryKey(e: WatchEntry) {
  return `${e.provider}:${e.id}:${e.season}:${e.episode}`;
}

function WatchCard({ entry }: { entry: WatchEntry }) {
  const pct =
    entry.duration > 0 ? Math.min(100, Math.round((entry.position / entry.duration) * 100)) : 5;
  const href = `/watch/${entry.provider}/${entry.id}?${
    entry.mediaType === "series" ? `s=${entry.season}&e=${entry.episode}` : ""
  }`;
  return (
    <Link
      href={href}
      className="group w-[34%] shrink-0 sm:w-[22%] md:w-[16%] lg:w-[12.5%]"
      aria-label={entry.title}
    >
      <div className="tick-corners relative overflow-hidden rounded-lg bg-surface ring-1 ring-line transition duration-300 hover:ring-brand/50 hover:shadow-[0_10px_24px_rgba(0,0,0,0.4),0_0_20px_rgba(34,197,94,0.12)]">
        <div className="relative aspect-video w-full overflow-hidden rounded-lg">
          {/* Continue-watching tiles use landscape crops of the poster artwork */}
          <PosterBackdrop src={entry.poster} title={entry.title} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
          {/* Square green play chip on hover */}
          <span className="pointer-events-none absolute right-2 top-2 z-10 grid h-8 w-8 -translate-y-1.5 place-items-center rounded-[6px] bg-brand text-black opacity-0 shadow-[0_0_16px_rgba(34,197,94,0.5)] transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-hover:bg-brand-hover">
            <PlayIcon width={13} height={13} className="translate-x-px" />
          </span>
          <span className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] text-brand ring-1 ring-brand/25 backdrop-blur-sm">
            {entry.mediaType === "series"
              ? `S${String(entry.season).padStart(2, "0")} E${String(entry.episode).padStart(2, "0")}`
              : "FILM"}
          </span>
          {/* Progress hairline */}
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/15">
            <div
              className="h-full bg-brand shadow-[0_0_8px_rgba(34,197,94,0.8)] transition-shadow duration-200 group-hover:shadow-[0_0_12px_rgba(34,197,94,1)]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
      <p className="mt-2 line-clamp-1 text-[13px] font-medium text-zinc-300 group-hover:text-white">
        {entry.title}
      </p>
      <p className="mono-meta mt-0.5 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-zinc-500">
        <span>{entry.mediaType === "series" ? "RESUME" : "REWATCH"}</span>
        <span className="text-brand">{pct}%</span>
      </p>
    </Link>
  );
}

function PosterBackdrop({ src, title }: { src: string | null; title: string }) {
  if (!src) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-surface-2">
        <span className="text-lg font-black text-brand/50">{title.charAt(0)}</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    // Poster artwork center-cropped to landscape
    <img
      src={src}
      alt=""
      className="absolute inset-0 h-full w-full object-cover"
      loading="lazy"
      decoding="async"
    />
  );
}
