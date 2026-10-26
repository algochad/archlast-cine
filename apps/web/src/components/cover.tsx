"use client";

import Image from "next/image";
import { useState } from "react";
import type { MediaType } from "@/lib/types";

/** Short, source-agnostic label for a media type. */
export function mediaTypeLabel(type: MediaType): string {
  return type === "series" ? "Series" : type === "anime" ? "Anime" : "Movie";
}

/** Cover artwork with a graceful, on-brand fallback tile. */
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
    const letter = alt.trim().charAt(0).toUpperCase() || "•";
    return (
      <div
        className={`absolute inset-0 grid place-items-center overflow-hidden bg-[radial-gradient(120%_90%_at_20%_0%,rgba(34,197,94,0.28),transparent_60%),linear-gradient(160deg,#1a1a1d,#0c0c0d)] ${className}`}
        aria-label={alt}
        role="img"
      >
        <span className="font-display text-6xl font-extrabold text-white/15 select-none">{letter}</span>
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
      className={`object-cover ${className}`}
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}
