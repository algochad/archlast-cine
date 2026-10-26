import type { BrowseMetrics, CatalogItem } from "@/lib/types";

export interface RowDef {
  key: string;
  label: string;
  items: CatalogItem[];
}

export type MetricKey = keyof Pick<BrowseMetrics, "trending" | "rating" | "recent_rating" | "popularity">;

export const METRIC_ROWS: { key: MetricKey; label: string }[] = [
  { key: "trending", label: "Trending Now" },
  { key: "rating", label: "Top Rated All-Time" },
  { key: "recent_rating", label: "Fresh & Hot" },
  { key: "popularity", label: "Most Watched" },
];

const dedupe = (items: CatalogItem[]): CatalogItem[] => {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = `${i.id.provider}:${i.id.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export function metricOf(item: CatalogItem, metrics: Record<string, BrowseMetrics>): BrowseMetrics {
  return metrics[item.id.value] ?? {};
}

export function buildMetricRows(
  feed: CatalogItem[],
  metrics: Record<string, BrowseMetrics>,
  limit = 20,
): RowDef[] {
  const unique = dedupe(feed).filter((i) => i.poster_url);
  return METRIC_ROWS.map(({ key, label }) => {
    const value = (i: CatalogItem) => metricOf(i, metrics)[key] ?? -Infinity;
    const items = [...unique].sort((a, b) => value(b) - value(a)).slice(0, limit);
    return { key, label, items };
  }).filter((row) => row.items.length > 0);
}

export function buildTypeRows(
  feed: CatalogItem[],
  metrics: Record<string, BrowseMetrics>,
  limit = 20,
): RowDef[] {
  const unique = dedupe(feed).filter((i) => i.poster_url);
  const score = (i: CatalogItem) =>
    metricOf(i, metrics).rating ?? metricOf(i, metrics).trending ?? -Infinity;
  const pick = (type: CatalogItem["media_type"]) =>
    [...unique].filter((i) => i.media_type === type).sort((a, b) => score(b) - score(a)).slice(0, limit);
  const rows: RowDef[] = [];
  const movies = pick("movie");
  const series = pick("series");
  if (movies.length) rows.push({ key: "movies", label: "Movies", items: movies });
  if (series.length) rows.push({ key: "series", label: "Series", items: series });
  return rows;
}

/** Pick the hero: strongest trending item when possible, else the first poster item. */
export function pickHero(feed: CatalogItem[], metrics: Record<string, BrowseMetrics>): CatalogItem | null {
  const candidates = dedupe(feed).filter((i) => i.poster_url);
  if (!candidates.length) return null;
  const scored = [...candidates].sort(
    (a, b) =>
      (metricOf(b, metrics).trending ?? -Infinity) - (metricOf(a, metrics).trending ?? -Infinity),
  );
  const top = scored[0];
  const topScore = metricOf(top, metrics).trending;
  return topScore != null && topScore > 0 ? top : candidates[0];
}

/**
 * Pick up to `count` featured titles for the hero carousel: strongest trending
 * first, preferring titles that have landscape art (IMDb-keyed) and keeping a
 * movie/series mix rather than five episodes of the same kind.
 */
export function pickHeroes(
  feed: CatalogItem[],
  metrics: Record<string, BrowseMetrics>,
  count = 5,
): CatalogItem[] {
  const trending = (i: CatalogItem) => metricOf(i, metrics).trending ?? -Infinity;
  const ranked = [...dedupe(feed).filter((i) => i.poster_url)].sort((a, b) => trending(b) - trending(a));
  const withArt = ranked.filter((i) => i.id.provider === "collaps");
  const pool = withArt.length >= count ? withArt : [...withArt, ...ranked.filter((i) => i.id.provider !== "collaps")];

  const picked: CatalogItem[] = [];
  const perType = new Map<string, number>();
  const cap = Math.ceil(count / 2) + 1;
  for (const candidate of pool) {
    if (picked.length >= count) break;
    const used = perType.get(candidate.media_type) ?? 0;
    if (used >= cap) continue;
    perType.set(candidate.media_type, used + 1);
    picked.push(candidate);
  }
  // A skewed feed (e.g. only movies) must still fill the carousel.
  for (const candidate of pool) {
    if (picked.length >= count) break;
    if (!picked.includes(candidate)) picked.push(candidate);
  }
  return picked;
}
