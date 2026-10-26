import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { backendJson } from "@/lib/server-api";
import { decodeTitleRef } from "@/lib/title-ref";
import type { DetailsResponse } from "@/lib/types";
import { WatchClient, type WatchPlayerProvider } from "./watch-client";

export const dynamic = "force-dynamic";

type Params = Promise<{ ref: string }>;
type Search = Promise<{ s?: string; e?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const parsed = decodeTitleRef((await params).ref);
  if (!parsed) return { title: "Watch" };
  const res = await backendJson<DetailsResponse>(
    `/api/details?provider=${parsed.provider}&id=${encodeURIComponent(parsed.id)}`,
    5000,
  );
  return { title: res.ok ? `Watch ${res.data.details.title}` : "Watch" };
}

export default async function WatchPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const parsed = decodeTitleRef((await params).ref);
  // Addon catalogs have no playback path in the gateway.
  if (!parsed || parsed.provider === "addons") notFound();
  const sp = await searchParams;
  const rawSeason = Number.parseInt(sp.s ?? "", 10);
  const rawEpisode = Number.parseInt(sp.e ?? "", 10);
  // Anime episodes are 1-based and the resolver requires episode >= 1, so a
  // bare link (no ?s= / ?e=) boots S1E1 instead of S0E0.
  let season = Number.isFinite(rawSeason) ? rawSeason : 0;
  let episode = Number.isFinite(rawEpisode) ? rawEpisode : 0;
  if (parsed.provider === "anime") {
    if (!(season > 0)) season = 1;
    if (!(episode > 0)) episode = 1;
  }
  return <WatchClient provider={parsed.provider as WatchPlayerProvider} id={parsed.id} season={season} episode={episode} />;
}
