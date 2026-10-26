import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrowseView, type BrowseKind } from "@/components/browse-view";
import { buildMetricRows } from "@/lib/rows";
import { backendJson } from "@/lib/server-api";
import type { BrowseMetrics, CatalogItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: Record<string, { kind: BrowseKind; title: string; blurb: string }> = {
  movies: { kind: "movie", title: "Movies", blurb: "From blockbusters to hidden gems — hand-picked for tonight." },
  series: { kind: "series", title: "Series", blurb: "Binge-worthy shows, season after season." },
  anime: { kind: "anime", title: "Anime", blurb: "The best of what’s airing and all-time favorites." },
};

type Params = Promise<{ kind: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const def = KINDS[(await params).kind];
  return { title: def?.title ?? "Browse" };
}

interface HomePayload {
  items: CatalogItem[];
  metrics: Record<string, BrowseMetrics>;
}
interface AnimePayload {
  items: CatalogItem[];
}

export default async function BrowsePage({ params }: { params: Params }) {
  const def = KINDS[(await params).kind];
  if (!def) notFound();

  if (def.kind === "anime") {
    const [trending, popular, recent] = await Promise.all([
      backendJson<AnimePayload>("/api/anime/trending", 9000),
      backendJson<AnimePayload>("/api/anime/popular", 9000),
      backendJson<AnimePayload>("/api/anime/recent", 9000),
    ]);
    const rows = [
      { key: "trending", label: "Trending now", items: trending.ok ? trending.data.items : [] },
      { key: "popular", label: "All-time popular", items: popular.ok ? popular.data.items : [] },
      { key: "recent", label: "Airing this season", items: recent.ok ? recent.data.items : [] },
    ].filter((r) => r.items.length > 0);
    return <BrowseView kind="anime" title={def.title} blurb={def.blurb} rows={rows} metrics={{}} error={rows.length === 0 ? "The anime catalog didn’t respond." : null} />;
  }

  const home = await backendJson<HomePayload>("/api/home?tab=2&page=1", 9000);
  if (!home.ok) {
    return <BrowseView kind={def.kind} title={def.title} blurb={def.blurb} rows={[]} metrics={{}} error={home.error} />;
  }
  const items = home.data.items.filter((i) => i.media_type === def.kind);
  const rows = buildMetricRows(items, home.data.metrics, 20).map((r) => ({
    key: r.key,
    label: r.label,
    items: r.items,
  }));
  return <BrowseView kind={def.kind} title={def.title} blurb={def.blurb} rows={rows} metrics={home.data.metrics} error={null} />;
}
