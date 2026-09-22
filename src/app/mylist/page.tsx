"use client";

import Link from "next/link";
import { XIcon } from "@/components/icons";
import { TitleCard } from "@/components/title-card";
import type { MyListItem } from "@/lib/account";
import { useMyList, useSession } from "@/lib/session";
import type { CatalogItem, ProviderId } from "@/lib/types";

/** My-list rows carry the provider catalog identity — reuse the shared card. */
function toCatalogItem(item: MyListItem): CatalogItem {
  return {
    id: { provider: item.provider as ProviderId, value: item.id },
    title: item.title,
    media_type: item.mediaType,
    year: item.year,
    poster_url: item.poster,
    season_count: null,
  };
}

export default function MyListPage() {
  const { items, ready, toggle } = useMyList();
  const { status } = useSession();

  return (
    <div className="mx-auto w-full max-w-[1560px] px-5 pb-28 pt-28 md:px-8 xl:px-12">
      <p className="eyebrow">// Archlast Cine · Account</p>
      <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
        <h1 className="display-title text-4xl">My List</h1>
        {ready && items.length > 0 && (
          <span className="mono-meta pb-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {String(items.length).padStart(2, "0")} saved
          </span>
        )}
      </div>

      {!ready ? (
        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton aspect-[2/3] w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="glass-panel mt-10 rounded-lg px-6 py-16 text-center">
          <p className="mono-meta text-[11px] font-bold uppercase tracking-[0.22em] text-brand">
            // Your list is empty — hover a title and press +
          </p>
          {status === "anon" && (
            <p className="mt-4 text-sm text-zinc-400">
              <Link href="/login" className="text-brand transition hover:text-brand-hover">
                Sign in
              </Link>{" "}
              to sync it across devices.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item) => (
            <div key={`${item.provider}:${item.id}`} className="group/card relative">
              <TitleCard item={toCatalogItem(item)} />
              <button
                type="button"
                aria-label={`Remove ${item.title} from my list`}
                onClick={() =>
                  void toggle({
                    provider: item.provider,
                    id: item.id,
                    title: item.title,
                    poster: item.poster,
                    mediaType: item.mediaType,
                    year: item.year,
                  })
                }
                className="absolute left-2 top-2 z-20 grid h-7 w-7 place-items-center rounded-[6px] bg-black/75 text-zinc-300 opacity-0 ring-1 ring-white/15 backdrop-blur transition duration-200 hover:bg-brand hover:text-black focus-visible:opacity-100 group-hover/card:opacity-100"
              >
                <XIcon width={13} height={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
