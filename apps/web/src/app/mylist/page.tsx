"use client";

import Link from "next/link";
import { BookmarkIcon, XIcon } from "@/components/icons";
import { TitleCard } from "@/components/title-card";
import type { MyListItem } from "@/lib/account";
import { useMyList, useSession } from "@/lib/session";
import type { CatalogItem, ProviderId } from "@/lib/types";

const GRID = "grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7";

/** List rows carry catalog identity — reuse the shared card. */
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
    <div className="page-shell pb-28 pt-28 md:pt-36">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <h1 className="display-title text-[clamp(2.2rem,4vw,3.2rem)]">My List</h1>
        {ready && items.length > 0 && (
          <span className="chip mb-1.5">{items.length} saved</span>
        )}
      </div>

      {!ready ? (
        <div className={`${GRID} mt-12`}>
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index}>
              <div className="skeleton aspect-[2/3] w-full rounded-[1.1rem]" />
              <div className="skeleton mt-3 h-3.5 w-3/4 rounded-md" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="glass mx-auto mt-14 max-w-xl rounded-3xl px-8 py-16 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-brand-hover ring-1 ring-brand/40">
            <BookmarkIcon width={28} height={28} />
          </span>
          <h2 className="section-title mt-6 text-2xl">Your list is empty</h2>
          <p className="mt-2 text-sm text-zinc-400">Tap the + on any title to keep it here for later.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/" className="btn-solid px-7 py-3 text-sm">
              Browse titles
            </Link>
            {status === "anon" && (
              <Link href="/login" className="btn-glass px-7 py-3 text-sm">
                Sign in to sync
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className={`${GRID} mt-12`}>
          {items.map((item) => (
            <div key={`${item.provider}:${item.id}`} className="group/list relative">
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
                className="absolute bottom-[3.4rem] right-2.5 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-zinc-200 opacity-0 ring-1 ring-white/20 backdrop-blur-md transition hover:bg-rose hover:text-white focus-visible:opacity-100 group-hover/list:opacity-100"
              >
                <XIcon width={14} height={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
