import { notFound, redirect } from "next/navigation";
import { watchHref } from "@/lib/title-ref";

export const dynamic = "force-dynamic";

const KNOWN = new Set(["collaps", "moviebox", "fourkhdhub", "bdix_circleftp", "bdix_dhakaflix", "addons", "anime"]);

/** Legacy `/watch/<provider>/<id>` links (old bookmarks, history) → provider-free URL. */
export default async function LegacyWatchRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string; id: string }>;
  searchParams: Promise<{ s?: string; e?: string }>;
}) {
  const { ref: provider, id } = await params;
  if (!KNOWN.has(provider) || !id) notFound();
  const sp = await searchParams;
  const season = Number.parseInt(sp.s ?? "", 10);
  const episode = Number.parseInt(sp.e ?? "", 10);
  redirect(
    watchHref(provider, decodeURIComponent(id), Number.isFinite(season) && Number.isFinite(episode) ? { season, episode } : null),
  );
}
