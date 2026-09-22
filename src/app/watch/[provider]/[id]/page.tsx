import { WatchClient, type WatchPlayerProvider } from "./watch-client";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const VALID: Record<string, true> = {
  moviebox: true,
  fourkhdhub: true,
  bdix_circleftp: true,
  bdix_dhakaflix: true,
  anime: true,
};

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string; id: string }>;
  searchParams: Promise<{ s?: string; e?: string }>;
}) {
  const { provider, id } = await params;
  const sp = await searchParams;
  if (!VALID[provider] || !id) notFound();
  const rawSeason = Number.parseInt(sp.s ?? "", 10);
  const rawEpisode = Number.parseInt(sp.e ?? "", 10);
  // Anime episodes are 1-based and the resolver requires episode >= 1, so a
  // bare /watch/anime/<id> link (no ?s= / ?e=) boots S1E1 instead of S0E0.
  let season = Number.isFinite(rawSeason) ? rawSeason : 0;
  let episode = Number.isFinite(rawEpisode) ? rawEpisode : 0;
  if (provider === "anime") {
    if (!(season > 0)) season = 1;
    if (!(episode > 0)) episode = 1;
  }

  return (
    <WatchClient
      provider={provider as WatchPlayerProvider}
      id={id}
      season={season}
      episode={episode}
    />
  );
}

