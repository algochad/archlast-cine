import { notFound } from "next/navigation";
import { ChapterListClient } from "./chapter-list-client";

export const dynamic = "force-dynamic";

export default async function ReadPage({
  params,
}: {
  params: Promise<{ provider: string; id: string }>;
}) {
  const { provider, id } = await params;
  // The reader is manga-only for now; other providers keep the watch flow.
  if (provider !== "manga" || !id) notFound();
  return <ChapterListClient provider="manga" id={id} />;
}