"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, XIcon } from "@/components/icons";
import { TitleCard } from "@/components/title-card";
import { api } from "@/lib/api";
import type { CatalogItem, MediaType } from "@/lib/types";

type TypeFilter = "all" | MediaType;

const TYPES: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "series", label: "Series" },
  { id: "anime", label: "Anime" },
];

const GRID = "grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7";

interface SearchState {
  query: string;
  items: CatalogItem[];
}

function itemKey(item: CatalogItem): string {
  return `${item.id.provider}:${item.id.value}`;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [mediaType, setMediaType] = useState<TypeFilter>("all");
  const [state, setState] = useState<SearchState | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trending, setTrending] = useState<CatalogItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<number | null>(null);
  const requestId = useRef(0);
  const inputFocused = useRef(false);
  const committedRef = useRef("");

  // Idle state: show what's popular right now.
  useEffect(() => {
    let cancelled = false;
    api
      .home()
      .then((res) => {
        if (!cancelled) setTrending(res.items.filter((i) => i.poster_url).slice(0, 14));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Autocomplete.
  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2 || !inputFocused.current) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    debounce.current = window.setTimeout(async () => {
      // Don't reopen over results: user already submitted this exact query.
      if (!inputFocused.current || q === committedRef.current) return;
      try {
        const res = await api.suggest(q);
        if (!inputFocused.current) return;
        // Suggestions are merged across catalogs; dedupe case-insensitively.
        const seen = new Set<string>();
        const unique = res.suggestions.filter((s) => {
          const k = s.trim().toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        setSuggestions(unique.slice(0, 8));
        setSuggestOpen(true);
        setHighlight(-1);
      } catch {
        setSuggestions([]);
      }
    }, 180);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [query]);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const id = ++requestId.current;
    setSearching(true);
    setError(null);
    setSuggestOpen(false);
    setSuggestions([]);
    setHighlight(-1);
    setCommitted(trimmed);
    committedRef.current = trimmed;
    inputFocused.current = false;
    inputRef.current?.blur();
    try {
      window.history.replaceState(null, "", `/search?q=${encodeURIComponent(trimmed)}`);
    } catch {
      /* non-fatal */
    }
    try {
      const res = await fetch(`/api/mb/search/unified?q=${encodeURIComponent(trimmed)}&page=1`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: CatalogItem[] };
      if (id !== requestId.current) return;
      const seen = new Set<string>();
      const items = (data.items ?? []).filter((item) => {
        const key = itemKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setState({ query: trimmed, items });
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : "Search failed");
      setState(null);
    } finally {
      if (id === requestId.current) setSearching(false);
    }
  }, []);

  // Deep link: /search?q=…
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q")?.trim();
    if (initial) {
      setQuery(initial);
      void runSearch(initial);
    } else {
      inputRef.current?.focus();
    }
  }, [runSearch]);

  const submit = (value?: string) => {
    const q = (value ?? query).trim();
    if (q) void runSearch(q);
  };

  const filtered = useMemo(
    () => (state ? state.items.filter((item) => mediaType === "all" || item.media_type === mediaType) : []),
    [state, mediaType],
  );
  const counts = useMemo(() => {
    const byType = new Map<string, number>();
    for (const item of state?.items ?? []) byType.set(item.media_type, (byType.get(item.media_type) ?? 0) + 1);
    return byType;
  }, [state]);

  const showSuggest = suggestOpen && suggestions.length > 0 && !searching;

  const clear = () => {
    setQuery("");
    setCommitted("");
    committedRef.current = "";
    setState(null);
    setError(null);
    setSuggestions([]);
    setSuggestOpen(false);
    setMediaType("all");
    try {
      window.history.replaceState(null, "", "/search");
    } catch {
      /* non-fatal */
    }
    inputRef.current?.focus();
  };

  return (
    <div className="page-shell min-h-screen pb-28 pt-28 md:pt-36">
      {/* ---------- Search head ---------- */}
      <div className="animate-fade-up mx-auto max-w-3xl text-center">
        <h1 className="display-title text-[clamp(2.2rem,5vw,3.8rem)]">
          Find your next <span className="gradient-text">favorite</span>
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] text-zinc-400">
          Movies, series and anime in one search — pick a title and press play.
        </p>

        <div className="relative mt-8 text-left">
          <div className="glass flex items-center gap-3 rounded-full px-5 py-2.5 shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition duration-200 focus-within:border-brand/60 focus-within:shadow-[0_0_0_4px_rgba(124,108,255,0.16),0_20px_60px_rgba(0,0,0,0.45)]">
            <SearchIcon width={20} height={20} className="shrink-0 text-brand-hover" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                inputFocused.current = true;
              }}
              onBlur={() => {
                inputFocused.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit(showSuggest && highlight >= 0 ? suggestions[highlight] : undefined);
                else if (e.key === "ArrowDown" && showSuggest) {
                  e.preventDefault();
                  setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
                } else if (e.key === "ArrowUp" && showSuggest) {
                  e.preventDefault();
                  setHighlight((h) => Math.max(0, h - 1));
                } else if (e.key === "Escape") {
                  setSuggestOpen(false);
                }
              }}
              placeholder="Search for a movie, series or anime"
              className="w-full bg-transparent py-2 text-[16px] text-white placeholder-zinc-500 outline-none"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search titles"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={clear}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
              >
                <XIcon width={15} height={15} />
              </button>
            )}
            <button type="button" onClick={() => submit()} disabled={searching} className="btn-solid shrink-0 px-6 py-2.5 text-sm disabled:opacity-60">
              {searching ? "Searching…" : "Search"}
            </button>
          </div>

          {showSuggest && (
            <div
              role="listbox"
              className="glass absolute inset-x-3 top-full z-30 mt-3 overflow-hidden rounded-3xl bg-surface/95 p-2 shadow-[0_24px_70px_rgba(0,0,0,0.7)]"
            >
              {suggestions.map((s, i) => (
                <button
                  key={`${s.toLowerCase()}::${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => {
                    setQuery(s);
                    submit(s);
                  }}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[15px] transition ${
                    i === highlight ? "bg-brand-soft text-white" : "text-zinc-300 hover:bg-white/[0.06]"
                  }`}
                >
                  <SearchIcon width={15} height={15} className={i === highlight ? "text-brand-hover" : "text-zinc-500"} />
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {state && state.items.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2" role="group" aria-label="Filter by type">
            {TYPES.map((t) => {
              const count = t.id === "all" ? state.items.length : (counts.get(t.id) ?? 0);
              if (t.id !== "all" && count === 0) return null;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={mediaType === t.id}
                  onClick={() => setMediaType(t.id)}
                  className="chip !px-4 !py-2 text-sm"
                >
                  {t.label}
                  <span className="text-xs font-normal text-zinc-500">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------- Results ---------- */}
      {error && (
        <div className="glass mx-auto mt-12 max-w-xl rounded-3xl p-8 text-center">
          <h2 className="section-title text-xl">Search didn’t go through</h2>
          <p className="mt-2 text-sm text-zinc-400">Something went wrong while looking for “{committed}”.</p>
          <button type="button" onClick={() => committed && void runSearch(committed)} className="btn-solid mt-5 px-7 py-2.5 text-sm">
            Try again
          </button>
        </div>
      )}

      {searching && (
        <div className={`${GRID} mt-14`}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton aspect-[2/3] rounded-[1.1rem]" />
              <div className="skeleton mt-3 h-3.5 w-3/4 rounded-md" />
            </div>
          ))}
        </div>
      )}

      {!searching && filtered.length > 0 && (
        <div className="animate-fade-in mt-14">
          <p className="mb-6 text-sm text-zinc-400">
            <span className="font-semibold text-white">
              {filtered.length} {filtered.length === 1 ? "result" : "results"}
            </span>{" "}
            for “{committed}”
          </p>
          <div className={GRID}>
            {filtered.map((item) => (
              <TitleCard key={itemKey(item)} item={item} />
            ))}
          </div>
        </div>
      )}

      {!searching && !error && state && state.items.length > 0 && filtered.length === 0 && (
        <div className="mt-20 text-center">
          <p className="text-zinc-300">Nothing in this category for “{committed}”.</p>
          <button type="button" onClick={() => setMediaType("all")} className="btn-glass mt-5 px-6 py-2.5 text-sm">
            Show everything
          </button>
        </div>
      )}

      {!searching && !error && state && state.items.length === 0 && (
        <div className="mt-20 text-center">
          <h2 className="section-title text-2xl">No matches for “{committed}”</h2>
          <p className="mt-2 text-sm text-zinc-500">Check the spelling or try a shorter title.</p>
        </div>
      )}

      {!searching && !state && !error && trending.length > 0 && (
        <section className="mt-20" aria-label="Popular right now">
          <h2 className="section-title mb-6 text-xl">Popular right now</h2>
          <div className={GRID}>
            {trending.map((item) => (
              <TitleCard key={itemKey(item)} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
