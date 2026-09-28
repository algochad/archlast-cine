import { notFound } from "next/navigation";
import { TitleDetail } from "@/components/title-detail";
import type { DetailsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const backend = process.env.MB_BACKEND_URL ?? "http://127.0.0.1:9797";
const VALID: Record<string, true> = {
  moviebox: true,
  fourkhdhub: true,
  bdix_circleftp: true,
  bdix_dhakaflix: true,
  anime: true,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ provider: string; id: string }>;
}) {
  const { provider, id } = await params;
  return { title: `${provider}:${id}` };
}

export default async function TitlePage({
  params,
}: {
  params: Promise<{ provider: string; id: string }>;
}) {
  const { provider, id } = await params;
  if (!VALID[provider] || !id) notFound();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let payload: DetailsResponse | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(
      `${backend}/api/details?provider=${provider}&id=${encodeURIComponent(id)}`,
      { cache: "no-store", signal: controller.signal },
    );
    if (!res.ok) {
      error = res.status === 404 ? "not found" : `backend HTTP ${res.status}`;
    } else {
      payload = (await res.json()) as DetailsResponse;
    }
  } catch {
    error = "backend unreachable";
  } finally {
    clearTimeout(timer);
  }

  if (error === "not found") notFound();

  return (
    <div className="min-h-screen">
      {payload ? (
        <TitleDetail details={payload.details} />
      ) : (
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
          <p className="text-4xl">📡</p>
          <h1 className="text-xl font-bold">Unable to load this title</h1>
          <p className="max-w-sm text-sm text-zinc-400">
            {error}. The Rust backend may be offline — start it with{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">npm run backend</code> and retry.
          </p>
          <a
            href={`/title/${provider}/${id}`}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-bold text-white"
          >
            Retry
          </a>
        </div>
      )}
    </div>
  );
}
