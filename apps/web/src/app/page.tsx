import { HomeFeed } from "@/components/home-feed";
import type { HeroSlide } from "@/components/hero";
import { formatRuntime } from "@/lib/format";
import { pickHeroes } from "@/lib/rows";
import { backendJson } from "@/lib/server-api";
import type { BrowseMetrics, CatalogItem, DetailsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

interface HomePayload {
  items: CatalogItem[];
  metrics: Record<string, BrowseMetrics>;
}

async function buildSlides(feed: CatalogItem[], metrics: Record<string, BrowseMetrics>): Promise<HeroSlide[]> {
  const heroes = pickHeroes(feed, metrics, 5);
  // Overview/genres/runtime make the hero feel real; each lookup degrades alone.
  const details = await Promise.all(
    heroes.map((item) =>
      backendJson<DetailsResponse>(
        `/api/details?provider=${item.id.provider}&id=${encodeURIComponent(item.id.value)}`,
        5000,
      ),
    ),
  );
  return heroes.map((item, i) => {
    const d = details[i].ok ? details[i].data.details : null;
    return {
      item,
      rating: metrics[item.id.value]?.rating ?? null,
      overview: d?.description ?? null,
      genres: d?.genres ?? [],
      runtime: formatRuntime(d?.duration),
    };
  });
}

export default async function HomePage() {
  const home = await backendJson<HomePayload>("/api/home?tab=2&page=1", 9000);
  if (!home.ok) {
    return <HomeFeed feed={null} metrics={{}} slides={[]} error={home.error} />;
  }
  const { items, metrics } = home.data;
  const slides = await buildSlides(items, metrics);
  return <HomeFeed feed={items} metrics={metrics} slides={slides} error={null} />;
}
