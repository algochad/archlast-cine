"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, mbUrl } from "@/lib/api";
import { setReadingSyncAuthed, recordReading } from "@/lib/read-sync";
import { useSession } from "@/lib/session";
import type { MangaChapter, MangaChapterSummary, MediaDetails } from "@/lib/types";

interface ReaderClientProps {
  provider: "manga";
  id: string;
  chapter: number;
}

/**
 * Long-strip manga reader: renders every page of the chapter sequentially,
 * derives the current page from scroll position, records reading progress
 * (local always, server when signed in), and links prev/next chapters.
 */
export function ReaderClient({ provider, id, chapter }: ReaderClientProps) {
  const { status } = useSession();
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [chapters, setChapters] = useState<MangaChapterSummary[] | null>(null);
  const [current, setCurrent] = useState<MangaChapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visiblePage, setVisiblePage] = useState(1);

  useEffect(() => {
    setReadingSyncAuthed(status === "authed");
  }, [status]);

  // Title metadata + chapter list for navigation.
  useEffect(() => {
    let cancelled = false;
    api
      .details(provider, id)
      .then((d) => !cancelled && setDetails(d.details))
      .catch(() => undefined);
    api
      .mangaChapters(id)
      .then((c) => !cancelled && setChapters(c.chapters ?? []))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [provider, id]);

  // Chapter pages for the requested chapter number.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCurrent(null);
    setVisiblePage(1);
    window.scrollTo({ top: 0 });

    api
      .mangaChapters(id)
      .then((list) => {
        if (cancelled) return;
        const match = (list.chapters ?? []).find(
          (c) => Math.abs(c.number - chapter) < Number.EPSILON,
        );
        if (!match) throw new Error(`Chapter ${chapter} not found`);
        return api.mangaChapterDetail(id, match.id);
      })
      .then((res) => {
        if (!cancelled && res) setCurrent(res.chapter);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load chapter");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, chapter]);

  // Scroll position -> current page; recorded as reading progress.
  const progressRef = useRef(0);
  const onScroll = useCallback(() => {
    if (!current || current.pages.length === 0) return;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
    const page = Math.max(1, Math.min(current.pages.length, Math.ceil(ratio * current.pages.length)));
    setVisiblePage(page);
    progressRef.current = page;

    const patch = {
      provider,
      id,
      title: details?.title ?? current.id,
      poster: null,
      mediaType: "manga" as const,
      year: details?.year ?? null,
      chapter,
      page,
      totalPages: current.pages.length,
    };
    recordReading(patch);
  }, [provider, id, chapter, details, current]);

  useEffect(() => {
    if (!current) return;
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [current, onScroll]);

  // Force-flush progress when leaving the reader.
  useEffect(() => {
    return () => {
      const patch = progressRef.current > 0 ? {
        provider,
        id,
        title: details?.title ?? "",
        poster: null,
        mediaType: "manga" as const,
        year: details?.year ?? null,
        chapter,
        page: progressRef.current,
        totalPages: current?.pages.length ?? 0,
      } : null;
      if (patch) recordReading(patch, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { prev, next } = useMemo(() => {
    if (!chapters) return { prev: null as number | null, next: null as number | null };
    const sorted = [...chapters].sort((a, b) => a.number - b.number);
    const idx = sorted.findIndex((c) => Math.abs(c.number - chapter) < Number.EPSILON);
    return {
      prev: idx > 0 ? sorted[idx - 1].number : null,
      next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1].number : null,
    };
  }, [chapters, chapter]);

  if (error) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="mono-meta text-[11px] font-bold tracking-[0.3em] text-brand">// SIGNAL LOST</p>
        <p className="text-sm text-zinc-400">{error}</p>
        <Link
          href={`/read/${provider}/${id}`}
          className="btn-solid mono-meta px-5 py-2 text-[11px] font-bold uppercase tracking-[0.14em]"
        >
          Back to chapters
        </Link>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-5 py-10">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[2/3] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const pages = current.pages.filter((p) => p.url);

  return (
    <div className="pb-24">
      {/* Sticky reader header */}
      <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-3">
          <Link
            href={`/read/${provider}/${id}`}
            className="mono-meta text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition hover:text-brand"
          >
            ← {details?.title ?? "Manga"}
          </Link>
          <span className="mono-meta text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-300">
            Ch {chapter} · {visiblePage}/{pages.length}
          </span>
        </div>
      </header>

      {/* Long-strip pages */}
      <main className="mx-auto max-w-4xl space-y-1 px-0 sm:px-5">
        {pages.map((page, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${page.url}-${i}`}
            src={mbUrl(page.url as string)}
            alt={`Page ${i + 1}`}
            width={page.width > 0 ? page.width : undefined}
            height={page.height > 0 ? page.height : undefined}
            loading={i < 2 ? "eager" : "lazy"}
            decoding="async"
            className="block w-full bg-surface-2"
          />
        ))}
      </main>

      {/* Chapter navigation */}
      <nav className="mx-auto mt-10 flex max-w-4xl items-center justify-between gap-4 px-5">
        {prev != null ? (
          <Link
            href={`/read/${provider}/${id}/${prev}`}
            className="btn-glass mono-meta px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em]"
          >
            ← Chapter {prev}
          </Link>
        ) : (
          <span />
        )}
        {next != null ? (
          <Link
            href={`/read/${provider}/${id}/${next}`}
            className="btn-solid mono-meta px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em]"
          >
            Chapter {next} →
          </Link>
        ) : (
          <span className="mono-meta text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            End of latest chapter
          </span>
        )}
      </nav>
    </div>
  );
}