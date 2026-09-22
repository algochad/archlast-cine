import { notFound } from "next/navigation";
import { ReaderClient } from "./reader-client";

export const dynamic = "force-dynamic";

export default async function ReadChapterPage({
  params,
}: {
  params: Promise<{ provider: string; id: string; chapter: string }>;
}) {
  const { provider, id, chapter } = await params;
  // The reader is manga-only for now; other providers keep the watch flow.
  if (provider !== "manga" || !id || !chapter) notFound();
  const chapterNumber = Number.parseFloat(chapter);
  if (!Number.isFinite(chapterNumber)) notFound();
  return <ReaderClient provider="manga" id={id} chapter={chapterNumber} />;
}