"use client";

import Link from "next/link";
import { useState } from "react";
import { Cover } from "@/components/cover";
import { PlayIcon, XIcon } from "@/components/icons";
import type { WatchEntry } from "@/lib/account";
import { backdropUrl } from "@/lib/artwork";
import { formatClock } from "@/lib/format";
import { watchHref } from "@/lib/title-ref";

export function continueHref(entry: WatchEntry): string {
  return watchHref(
    entry.provider,
    entry.id,
    entry.mediaType === "movie" ? null : { season: entry.season, episode: entry.episode },
  );
}

function episodeLabel(entry: WatchEntry): string {
  if (entry.mediaType === "movie") return entry.year ? `Movie · ${entry.year}` : "Movie";
  return `S${entry.season} · E${entry.episode}`;
}

/** Landscape resume card: artwork, progress, remaining time. */
export function ContinueCard({ entry, onRemove }: { entry: WatchEntry; onRemove?: () => void }) {
  const art = backdropUrl(entry.provider, entry.id);
  const [artFailed, setArtFailed] = useState(false);
  const pct = entry.duration > 0 ? Math.min(100, Math.max(2, (entry.position / entry.duration) * 100)) : 4;
  const left = entry.duration > 0 ? Math.max(0, entry.duration - entry.position) : 0;

  return (
    <div className="group/continue relative w-[78%] shrink-0 snap-start sm:w-[46%] md:w-[34%] lg:w-[26%] xl:w-[22%]">
      <Link href={continueHref(entry)} aria-label={`Resume ${entry.title}`} className="group block rounded-2xl outline-none">
        <div className="poster aspect-video w-full overflow-hidden">
          {art && !artFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={art}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setArtFailed(true)}
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <Cover src={entry.poster} alt={entry.title} className="object-top transition duration-500 group-hover:scale-105" sizes="30vw" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
          <span className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white opacity-0 ring-1 ring-white/30 backdrop-blur-md transition duration-300 group-hover:opacity-100">
            <PlayIcon width={16} height={16} className="translate-x-px" />
          </span>
          <div className="absolute inset-x-0 bottom-0 p-4">
            <p className="truncate text-[15px] font-bold text-white drop-shadow">{entry.title}</p>
            <p className="mt-0.5 text-xs text-zinc-300">
              {episodeLabel(entry)}
              {left > 0 && <span className="text-zinc-400"> · {formatClock(left)} left</span>}
            </p>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
            <div
              className="h-full rounded-r-full bg-[linear-gradient(90deg,#7c6cff,#38d6f5)] shadow-[0_0_12px_rgba(124,108,255,0.8)]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Link>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${entry.title} from Continue Watching`}
          className="absolute left-2.5 top-2.5 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-zinc-300 opacity-0 ring-1 ring-white/20 backdrop-blur-md transition hover:bg-black/80 hover:text-white focus-visible:opacity-100 group-hover/continue:opacity-100"
        >
          <XIcon width={13} height={13} />
        </button>
      )}
    </div>
  );
}
