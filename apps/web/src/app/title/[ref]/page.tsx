import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TitleDetail } from "@/components/title-detail";
import { backendJson } from "@/lib/server-api";
import { decodeTitleRef } from "@/lib/title-ref";
import type { DetailsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ ref: string }>;

function detailsPath(provider: string, id: string) {
  return `/api/details?provider=${provider}&id=${encodeURIComponent(id)}`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const parsed = decodeTitleRef((await params).ref);
  if (!parsed) return { title: "Title" };
  const res = await backendJson<DetailsResponse>(detailsPath(parsed.provider, parsed.id), 6000);
  if (!res.ok) return { title: "Title" };
  const { title, description } = res.data.details;
  return { title, description: description ?? undefined };
}

export default async function TitlePage({ params }: { params: Params }) {
  const ref = (await params).ref;
  const parsed = decodeTitleRef(ref);
  if (!parsed) notFound();

  const res = await backendJson<DetailsResponse>(detailsPath(parsed.provider, parsed.id), 10000);
  if (!res.ok && res.status === 404) notFound();

  if (!res.ok) {
    return (
      <div className="page-shell flex min-h-[70vh] flex-col items-center justify-center gap-5 text-center">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="display-title text-4xl">We couldn’t load this title</h1>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          The media service didn’t answer in time. This is usually temporary — give it another try.
        </p>
        <Link href={`/title/${ref}`} className="btn-solid px-7 py-3 text-sm">
          Try again
        </Link>
      </div>
    );
  }
  return <TitleDetail details={res.data.details} />;
}
