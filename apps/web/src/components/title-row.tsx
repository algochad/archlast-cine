"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { TitleCard } from "@/components/title-card";
import type { CatalogItem } from "@/lib/types";

function ArrowButton({
  dir,
  label,
  onClick,
  disabled,
}: {
  dir: "left" | "right";
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong bg-white/[0.04] text-zinc-300 transition duration-200 hover:border-brand/60 hover:bg-brand/15 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30"
    >
      {dir === "left" ? <ChevronLeft width={18} height={18} /> : <ChevronRight width={18} height={18} />}
    </button>
  );
}

export function RowSkeleton() {
  return (
    <div className="space-y-5">
      <div className="skeleton h-7 w-56 rounded-lg" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="w-[42%] shrink-0 sm:w-[28%] md:w-[21%] lg:w-[16.5%] xl:w-[14%]">
            <div className="skeleton aspect-[2/3] rounded-[1.1rem]" />
            <div className="skeleton mt-3 h-3.5 w-3/4 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TitleRow({
  label,
  items,
  badge,
  moreHref,
  ranked = false,
  ratingOf,
}: {
  label: string;
  items: CatalogItem[];
  /** Small pill next to the heading, e.g. "Hot right now". */
  badge?: string;
  moreHref?: string;
  /** Big outlined rank numerals (1…n). */
  ranked?: boolean;
  /** Per-item rating chip. */
  ratingOf?: (item: CatalogItem) => number | null | undefined;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const updateArrows = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows, items.length]);

  const scroll = useCallback((dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  }, []);

  if (!items.length) return null;

  return (
    <section aria-label={label} className="group/row">
      <header className="mb-5 flex items-center gap-3">
        <h2 className="section-title text-[1.4rem] md:text-[1.65rem]">{label}</h2>
        {badge && (
          <span className="rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-hover">
            {badge}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {moreHref && (
            <Link href={moreHref} className="mr-2 hidden text-sm font-semibold text-zinc-400 transition hover:text-white sm:block">
              View all →
            </Link>
          )}
          <div className="hidden items-center gap-2 md:flex">
            <ArrowButton dir="left" label="Scroll back" onClick={() => scroll(-1)} disabled={!canLeft} />
            <ArrowButton dir="right" label="Scroll forward" onClick={() => scroll(1)} disabled={!canRight} />
          </div>
        </div>
      </header>

      <div
        ref={trackRef}
        role="list"
        className="scrollbar-none -mx-[var(--page-gutter)] flex snap-x gap-4 overflow-x-auto scroll-smooth px-[var(--page-gutter)] pb-4 pt-3 md:gap-5"
        style={{ scrollPaddingInline: "var(--page-gutter)" }}
      >
        {items.map((item, i) => (
          <div
            key={`${item.id.provider}:${item.id.value}`}
            role="listitem"
            className={`shrink-0 snap-start ${
              ranked
                ? "w-[52%] sm:w-[36%] md:w-[27%] lg:w-[21%] xl:w-[17.5%]"
                : "w-[42%] sm:w-[28%] md:w-[21%] lg:w-[16.5%] xl:w-[14%] 2xl:w-[12.4%]"
            }`}
          >
            <TitleCard item={item} rank={ranked ? i + 1 : undefined} rating={ratingOf?.(item)} />
          </div>
        ))}
      </div>
    </section>
  );
}
