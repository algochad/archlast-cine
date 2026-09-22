import { HomeFeed } from "@/components/home-feed";
import type { BrowseMetrics, CatalogItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const backend = process.env.MB_BACKEND_URL ?? "http://127.0.0.1:9797";

async function fetchHome() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(`${backend}/api/home?tab=2&page=1`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      return { feed: null, metrics: {} as Record<string, BrowseMetrics>, error: `Backend replied HTTP ${res.status}.` };
    }
    const data = (await res.json()) as { items: CatalogItem[]; metrics: Record<string, BrowseMetrics> };
    return { feed: data.items, metrics: data.metrics, error: null };
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "request timed out" : (e as Error).message;
    return {
      feed: null,
      metrics: {} as Record<string, BrowseMetrics>,
      error: `Backend unreachable (${reason}). Is the Rust service running on ${backend}?`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function HomePage() {
  const { feed, metrics, error } = await fetchHome();
  return <HomeFeed feed={feed} metrics={metrics} error={error} />;
}
