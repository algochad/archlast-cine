"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TitleCard } from "@/components/title-card";
import { SearchIcon, XIcon } from "@/components/icons";
import { api } from "@/lib/api";
import type { CatalogItem, MediaType, ProviderId } from "@/lib/types";

type SourceFilter = "all" | ProviderId;
type TypeFilter = "all" | MediaType;

const SOURCES: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "moviebox", label: "MovieBox" },
  { id: "fourkhdhub", label: "4KHDHub" },
  { id: "anime", label: "Anime" },
];

const TYPES: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "series", label: "Series" },
  { id: "anime", label: "Anime" },
];

interface SearchState {
  query: string;
  items: CatalogItem[];
  errors: { provider: string; error: string }[];
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
  const [source, setSource] = useState<SourceFilter>("all");
  const [mediaType, setMediaType] = useState<TypeFilter>("all");
  const [state, setState] = useState<SearchState | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<number | null>(null);
  const requestId = useRef(0);
  const inputFocused = useRef(false);
  const committedRef = useRef("");


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
        // The backend merges suggestions across providers, so the same
        // title can appear twice ("Tenet" + "Tenet") — dupe keys crash
        // React. Dedupe (case-insensitive) before rendering.
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
      const res = await fetch(
        `/api/mb/search/unified?q=${encodeURIComponent(trimmed)}&page=1`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        items: (CatalogItem & { provider?: ProviderId })[];
        errors?: { provider: string; error: string }[];
      };
      if (id !== requestId.current) return;
      const seen = new Set<string>();
      const items = (data.items ?? []).filter((item) => {
        const key = itemKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setState({ query: trimmed, items, errors: data.errors ?? [] });
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : "Search failed");
      setState(null);
    } finally {
      if (id === requestId.current) setSearching(false);
    }
  }, []);

  const submit = (value?: string) => {
    const q = (value ?? query).trim();
    if (!q) return;
    void runSearch(q);
  };

  const filtered = useMemo(() => {
    if (!state) return [];
    return state.items.filter((item) => {
      if (source !== "all" && item.id.provider !== source) return false;
      if (mediaType !== "all" && item.media_type !== mediaType) return false;
      return true;
    });
  }, [state, source, mediaType]);

  const counts = useMemo(() => {
    const bySource = new Map<string, number>();
    const byType = new Map<string, number>();
    for (const item of state?.items ?? []) {
      bySource.set(item.id.provider, (bySource.get(item.id.provider) ?? 0) + 1);
      byType.set(item.media_type, (byType.get(item.media_type) ?? 0) + 1);
    }
    return { bySource, byType };
  }, [state]);

  const results = filtered;
  const showSuggest = suggestOpen && suggestions.length > 0 && !searching;


  return (
    <div className="mx-auto min-h-screen w-full max-w-[1560px] px-5 pb-28 pt-24 md:px-8 md:pt-28 xl:px-12">
      {/* ---------- Search head ---------- */}
      <div className="animate-fade-up">
        <p className="eyebrow mb-3 flex items-center gap-2">
          <span className="h-px w-5 bg-brand" />
          Catalog Search
        </p>
        <h1 className="display-title text-[clamp(2rem,4vw,3.25rem)]">Search</h1>

        <div className="relative mt-7 max-w-3xl">
          {/* Terminal-style query bar */}
          <div className="glass-panel flex items-center gap-3 rounded-lg px-4 py-3.5 transition duration-200 focus-within:border-brand/40 focus-within:shadow-[0_0_0_3px_rgba(34,197,94,0.1),0_0_24px_rgba(34,197,94,0.06)]">
            <SearchIcon width={18} height={18} className="shrink-0 text-brand" />
            <span className="mono-meta shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-600">
              {">"}
            </span>
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
              placeholder="SEARCH MOVIES, SERIES & ANIME"
              className="mono-meta w-full bg-transparent text-[15px] text-white placeholder-zinc-500 outline-none"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search catalog"
            />
            {query && (
              <button
                aria-label="Clear"
                onClick={() => {
                  setQuery("");
                  setCommitted("");
                  setState(null);
                  setSuggestions([]);
                  setSuggestOpen(false);
                  setSource("all");
                  setMediaType("all");
                  inputRef.current?.focus();
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-line text-zinc-400 transition hover:border-brand/40 hover:bg-white/5 hover:text-brand"
              >
                <XIcon width={15} height={15} />
              </button>
            )}
            <button
              onClick={() => submit()}
              disabled={searching}
              className="btn-solid mono-meta shrink-0 px-5 py-2 text-[12px] font-bold uppercase tracking-[0.14em] disabled:cursor-default disabled:opacity-60"
            >
              {searching ? "Querying…" : "Search"}
            </button>
          </div>

          {/* Suggestions — mono rows with a left tick on the active one */}
          {showSuggest && (
            <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-line bg-raised/95 shadow-[0_18px_50px_rgba(0,0,0,0.7)] backdrop-blur">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.toLowerCase()}::${i}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => {
                    setQuery(s);
                    submit(s);
                  }}
                  className={`relative flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition duration-150 ${
                    i === highlight ? "bg-brand/10 font-semibold text-brand" : "text-zinc-300 hover:bg-white/5"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand transition-opacity duration-150 ${
                      i === highlight ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <SearchIcon
                    width={13}
                    height={13}
                    className={i === highlight ? "text-brand" : "text-zinc-500"}
                  />
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Source + type filters (client-side over one unified result set) */}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="mono-meta text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
              Source:
            </span>
            {SOURCES.map((s) => {
              const count = s.id === "all" ? (state?.items.length ?? 0) : (counts.bySource.get(s.id) ?? 0);
              const active = source === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSource(s.id)}
                  aria-pressed={active}
                  className={`mono-meta text-[11px] uppercase tracking-[0.1em] transition duration-150 ${
                    active
                      ? "rounded-[4px] bg-brand px-3 py-1.5 font-bold text-black shadow-[0_0_14px_rgba(34,197,94,0.25)]"
                      : "rounded-[4px] border border-line bg-white/[0.03] px-3 py-1.5 font-semibold text-zinc-400 hover:border-brand/40 hover:text-white"
                  }`}
                >
                  {s.label}
                  {state && <span className={active ? "opacity-70" : "text-zinc-600"}> · {count}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="mono-meta text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
              Type:
            </span>
            {TYPES.map((t) => {
              const count = t.id === "all" ? (state?.items.length ?? 0) : (counts.byType.get(t.id) ?? 0);
              const active = mediaType === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setMediaType(t.id)}
                  aria-pressed={active}
                  className={`mono-meta text-[11px] uppercase tracking-[0.1em] transition duration-150 ${
                    active
                      ? "rounded-[4px] bg-brand px-3 py-1.5 font-bold text-black shadow-[0_0_14px_rgba(34,197,94,0.25)]"
                      : "rounded-[4px] border border-line bg-white/[0.03] px-3 py-1.5 font-semibold text-zinc-400 hover:border-brand/40 hover:text-white"
                  }`}
                >
                  {t.label}
                  {state && <span className={active ? "opacity-70" : "text-zinc-600"}> · {count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---------- Results ---------- */}
      {error && (
        <div className="mt-10 max-w-3xl rounded-lg border border-line bg-surface/60 p-6 text-center">
          <p className="mono-meta text-[11px] font-bold uppercase tracking-[0.24em] text-brand">
            // Query Failed
          </p>
          <p className="mt-2 text-sm text-zinc-300">Search failed across sources.</p>
          <p className="mt-1 font-mono text-xs text-zinc-500">{error}</p>
          <button
            onClick={() => committed && void runSearch(committed)}
            className="btn-solid mono-meta mt-4 px-5 py-2 text-[12px] font-bold uppercase tracking-[0.14em]"
          >
            Retry
          </button>
        </div>
      )}

      {searching && (
        <div className="mt-12 grid grid-cols-3 gap-3.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[2/3] rounded-lg" />
          ))}
        </div>
      )}

      {!searching && results.length > 0 && (
        <div className="animate-fade-in mt-10">
          <p className="hairline-b mono-meta mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-3 text-[12px] uppercase tracking-[0.14em] text-zinc-500">
            <span className="font-bold text-brand">
              {results.length} {results.length === 1 ? "Result" : "Results"}
            </span>
            <span className="text-zinc-400">for “{committed}”</span>
            {(source !== "all" || mediaType !== "all") && state && (
              <span className="text-zinc-600">
                · filtered from {state.items.length}
              </span>
            )}
          </p>
          {!!state?.errors.length && (
            <p className="mono-meta mb-4 text-[11px] uppercase tracking-[0.12em] text-zinc-600">
              Partial results — {state.errors.map((e) => e.provider).join(", ")} unavailable
            </p>
          )}
          <div className="grid grid-cols-3 gap-3.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {results.map((item) => (
              <TitleCard key={itemKey(item)} item={item} />
            ))}
          </div>
        </div>
      )}

      {!searching && !error && state && results.length === 0 && state.items.length > 0 && (
        <div className="mt-20 text-center">
          <p className="mono-meta text-[11px] font-bold tracking-[0.3em] text-brand">// FILTERED OUT</p>
          <p className="mt-4 font-mono text-sm text-zinc-400">
            {state.items.length} RESULT{state.items.length === 1 ? "" : "S"} FOR “{committed.toUpperCase()}” — NONE MATCH THESE FILTERS
          </p>
          <button
            onClick={() => {
              setSource("all");
              setMediaType("all");
            }}
            className="btn-glass mono-meta mt-5 px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.14em]"
          >
            Clear filters
          </button>
        </div>
      )}

      {!searching && !error && state && state.items.length === 0 && (
        <div className="mt-20 text-center">
          <p className="mono-meta text-[11px] font-bold tracking-[0.3em] text-brand">// NO MATCH</p>
          <p className="mt-4 font-mono text-sm text-zinc-400">
            ZERO RESULTS FOR “{committed.toUpperCase()}” ACROSS ALL SOURCES
          </p>
          <p className="mt-2 font-mono text-xs text-zinc-600">
            TRY A DIFFERENT TITLE.
          </p>
        </div>
      )}

      {!searching && !state && !error && (
        <div className="mt-24 text-center">
          <p className="mono-meta text-[11px] font-bold tracking-[0.3em] text-zinc-600">
            // AWAITING QUERY
          </p>
          <p className="mx-auto mt-4 max-w-md font-mono text-[13px] leading-relaxed text-zinc-500">
            Search movies, series and anime across all sources at once, then press{" "}
            <kbd className="rounded-[4px] border border-line bg-surface px-1.5 py-0.5 text-[11px] text-zinc-300">
              ENTER
            </kbd>{" "}
            or pick a suggestion. Filter by source or type after.
          </p>
        </div>
      )}
    </div>
  );
}
