import { notFound, redirect } from "next/navigation";
import { titleHref } from "@/lib/title-ref";

export const dynamic = "force-dynamic";

const KNOWN = new Set(["collaps", "moviebox", "fourkhdhub", "bdix_circleftp", "bdix_dhakaflix", "addons", "anime"]);

/** Legacy `/title/<provider>/<id>` links → provider-free URL. */
export default async function LegacyTitleRedirect({ params }: { params: Promise<{ ref: string; id: string }> }) {
  const { ref: provider, id } = await params;
  if (!KNOWN.has(provider) || !id) notFound();
  redirect(titleHref(provider, decodeURIComponent(id)));
}
