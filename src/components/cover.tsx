import Image from "next/image";
import { useState } from "react";
import type { CatalogItem, MediaType } from "@/lib/types";
import { PlayIcon } from "@/components/icons";

export function qualityLabel(item: CatalogItem): string | null {
  if (item.media_type === "series") {
    return item.season_count && item.season_count > 0
      ? `${item.season_count} Season${item.season_count > 1 ? "s" : ""}`
      : "Series";
  }
  if (item.year) return item.year;
  return null;
}

/** Cover artwork with shimmer while loading and a graceful fallback tile. */
export function Cover({
  src,
  alt,
  className = "",
  sizes = "240px",
  priority = false,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const letter = alt.trim().charAt(0).toUpperCase() || "?";
    return (
      <div
        className={`grid place-items-center overflow-hidden bg-gradient-to-br from-surface-2 via-surface to-ink ${className}`}
        aria-label={alt}
        role="img"
      >
        <div className="flex flex-col items-center gap-2 px-2">
          <PlayIcon width={22} height={22} className="text-zinc-700" />
          <span className="w-full truncate text-center font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
            {letter}
            {" · poster offline"}
          </span>
        </div>
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={className}
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}

export function mediaTypeLabel(type: MediaType): string {
  return type === "series" ? "Series" : "Movie";
}
