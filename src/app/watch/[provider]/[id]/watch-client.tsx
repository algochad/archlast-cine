"use client";

import dynamic from "next/dynamic";

const WatchPlayer = dynamic(() => import("@/components/watch-player").then((m) => m.WatchPlayer), {
  ssr: false,
  loading: () => <div className="flex h-screen items-center justify-center">Loading player...</div>,
});

export type WatchPlayerProvider =
  | "moviebox"
  | "fourkhdhub"
  | "bdix_circleftp"
  | "bdix_dhakaflix"
  | "anime";

interface WatchClientProps {
  provider: WatchPlayerProvider;
  id: string;
  season: number;
  episode: number;
}

export function WatchClient({ provider, id, season, episode }: WatchClientProps) {
  return <WatchPlayer provider={provider} id={id} season={season} episode={episode} />;
}