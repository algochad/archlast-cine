import { TitleCard } from "@/components/title-card";
import type { CatalogItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const backend = process.env.MB_BACKEND_URL ?? "http://127.0.0.1:9797";

interface MangaBrowseState {
  items: CatalogItem[];
  page: number;
  error: string | null;
}

async function fetchTrending(page: number): Promise<MangaBrowseState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${backend}/api/manga/trending?page=${page}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        items: [],
        page,
        error:
          res.status === 502 || res.status === 503
            ? "Manga service is starting or unavailable — the catalog syncs once the MangaScrapper stack is up."
            : `Manga service replied HTTP ${res.status}.`,
      };
    }
    const data = (await res.json()) as { items?: CatalogItem[]; page?: number };
    return { items: data.items ?? [], page: data.page ?? page, error: null };
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "AbortError" ? "request timed out" : "backend unreachable";
    return {
      items: [],
      page,
      error: `Manga service ${reason}. Start it with npm run dev or docker compose -f docker-compose.dev.yml up manga-api manga-worker.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function MangaBrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const { items, error } = await fetchTrending(page);

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1560px] px-5 pb-28 pt-24 md:px-8 md:pt-28 xl:px-12">
      <div className="animate-fade-up">
        <p className="eyebrow mb-3 flex items-center gap-2">
          <span className="h-px w-5 bg-brand" />
          Manga Catalog
        </p>
        <h1 className="display-title text-[clamp(2rem,4vw,3.25rem)]">Manga</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Browse the trending catalog synced by the MangaScrapper worker. Open a title to
          read chapters in the long-strip reader.
        </p>
      </div>

      {error ? (
        <div className="mt-10 max-w-3xl rounded-lg border border-line bg-surface/60 p-6 text-center">
          <p className="mono-meta text-[11px] font-bold uppercase tracking-[0.24em] text-brand">
            {"// Manga Unavailable"}
          </p>
          <p className="mt-2 text-sm text-zinc-300">{error}</p>
          <a
            href="/manga"
            className="btn-solid mono-meta mt-4 inline-block px-5 py-2 text-[12px] font-bold uppercase tracking-[0.14em]"
          >
            Retry
          </a>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-20 text-center">
          <p className="mono-meta text-[11px] font-bold tracking-[0.3em] text-brand">
            {"// Empty Shelf"}
          </p>
          <p className="mt-4 font-mono text-sm text-zinc-400">
            NO TRENDING MANGA YET — THE WORKER HASN&apos;T SYNCED ANY TITLES
          </p>
          <p className="mt-2 font-mono text-xs text-zinc-600">
            Check the manga-worker logs; scraping jobs populate this catalog.
          </p>
        </div>
      ) : (
        <div className="animate-fade-in mt-10">
          <p className="hairline-b mono-meta mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-3 text-[12px] uppercase tracking-[0.14em] text-zinc-500">
            <span className="font-bold text-brand">
              {items.length} {items.length === 1 ? "Title" : "Titles"}
            </span>
            <span className="text-zinc-400">trending · page {page}</span>
          </p>
          <div className="grid grid-cols-3 gap-3.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {items.map((item) => (
              <TitleCard key={`${item.id.provider}:${item.id.value}`} item={item} />
            ))}
          </div>
          <div className="mt-10 flex items-center justify-center gap-3">
            {page > 1 && (
              <a
                href={page === 2 ? "/manga" : `/manga?page=${page - 1}`}
                className="btn-glass mono-meta px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.14em]"
              >
                ← Prev
              </a>
            )}
            <span className="mono-meta text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              Page {page}
            </span>
            {items.length >= 20 && (
              <a
                href={`/manga?page=${page + 1}`}
                className="btn-glass mono-meta px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.14em]"
              >
                Next →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
