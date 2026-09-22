"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, mbUrl } from "@/lib/api";
import type { MediaDetails, MangaChapterSummary } from "@/lib/types";

export function ChapterListClient({ provider, id }: { provider: "manga"; id: string }) {
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [chapters, setChapters] = useState<MangaChapterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.details(provider, id), api.mangaChapters(id)])
      .then(([d, c]) => {
        if (cancelled) return;
        setDetails(d.details);
        setChapters(c.chapters ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load manga");
      });
    return () => {
      cancelled = true;
    };
  }, [provider, id]);

  // Newest chapters first is the usual reader default.
  const sorted = useMemo(
    () => (chapters ? [...chapters].sort((a, b) => b.number - a.number) : null),
    [chapters],
  );

  if (error) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="mono-meta text-[11px] font-bold tracking-[0.3em] text-brand">// SIGNAL LOST</p>
        <p className="text-sm text-zinc-400">{error}</p>
      </div>
    );
  }

  if (!details || !sorted) {
    return (
      <div className="mx-auto max-w-[1560px] space-y-8 px-5 py-10 md:px-8 xl:px-12">
        <div className="skeleton h-[280px] w-full rounded-xl" />
        <div className="skeleton h-4 w-1/3 rounded" />
        <div className="skeleton h-4 w-2/3 rounded" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1560px] px-5 pb-28 pt-8 md:px-8 xl:px-12">
      {/* Title header: poster + metadata */}
      <header className="flex flex-col gap-6 sm:flex-row">
        <div className="relative aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-lg bg-surface ring-1 ring-line">
          {details.poster_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mbUrl(details.poster_url)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <span className="text-3xl font-black text-brand/40">{details.title.charAt(0)}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="mono-meta text-[11px] font-bold tracking-[0.3em] text-brand">// MANGA</p>
          <h1 className="text-2xl font-black tracking-tight text-zinc-50 md:text-3xl">
            {details.title}
          </h1>
          {details.director && <p className="text-sm text-zinc-400">by {details.director}</p>}
          {details.description && (
            <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">{details.description}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {details.genres.slice(0, 8).map((g) => (
              <span
                key={g}
                className="rounded-[4px] bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-400 ring-1 ring-line"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Chapter list */}
      <section className="mt-10" aria-label="Chapters">
        <header className="mb-4 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="mono-meta text-[11px] font-bold tracking-[0.16em] text-brand"
          >
            {String(sorted.length).padStart(2, "0")}
          </span>
          <h2 className="shrink-0 text-lg font-extrabold tracking-tight text-zinc-50">Chapters</h2>
          <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-line" />
        </header>
        {sorted.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No chapters yet — the MangaScrapper worker hasn&apos;t synced this title.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg ring-1 ring-line">
            {sorted.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/read/${provider}/${id}/${c.number}`}
                  className="flex items-center justify-between gap-4 bg-surface px-4 py-3 transition duration-150 hover:bg-surface-2"
                >
                  <span className="text-sm font-medium text-zinc-200">
                    Chapter {c.number % 1 === 0 ? c.number : c.number.toFixed(1)}
                  </span>
                  <span className="mono-meta text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    {c.totalPages > 0 ? `${c.totalPages} pages` : ""}
                    {c.language ? ` · ${c.language.toUpperCase()}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}