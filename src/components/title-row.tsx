"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { TitleCard } from "@/components/title-card";
import type { CatalogItem } from "@/lib/types";

function ArrowButton({
  dir,
  label,
  onClick,
  className = "",
}: {
  dir: "left" | "right";
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-line bg-ink/60 text-zinc-400 transition duration-150 hover:border-brand/50 hover:bg-brand/10 hover:text-brand active:scale-95 ${className}`}
    >
      {dir === "left" ? (
        <ChevronLeft width={18} height={18} />
      ) : (
        <ChevronRight width={18} height={18} />
      )}
    </button>
  );
}

export function RowSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="skeleton h-3.5 w-8 rounded-[3px]" />
        <div className="skeleton h-5 w-56 rounded-[3px]" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="skeleton aspect-[2/3] w-[30%] shrink-0 rounded-lg sm:w-[19%] md:w-[15.5%] lg:w-[12%]"
          />
        ))}
      </div>
    </div>
  );
}

export function TitleRow({
  label,
  items,
  onMore,
  rankFrom,
  index,
}: {
  label: string;
  items: CatalogItem[];
  onMore?: () => void;
  rankFrom?: number;
  index?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);
  const [hovering, setHovering] = useState(false);

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
    const card = el.querySelector<HTMLElement>("[data-card]");
    const step = Math.max(240, (card?.offsetWidth ?? 160) * 4);
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  if (!items.length) return null;

  return (
    <section
      className="group/row relative"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Header: mono index · display title · hairline · controls */}
      <header className="mb-4 flex items-center gap-3">
        {index != null && (
          <span
            aria-hidden="true"
            className="mono-meta text-[11px] font-bold tracking-[0.16em] text-brand"
          >
            {String(index).padStart(2, "0")}
          </span>
        )}
        <h2 className="shrink-0 text-lg font-extrabold tracking-tight text-zinc-50">
          {label}
        </h2>
        <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-line" />
        {onMore && (
          <button
            onClick={onMore}
            className="mono-meta shrink-0 text-[11px] font-bold tracking-[0.14em] text-zinc-400 transition hover:text-brand"
          >
            VIEW ALL →
          </button>
        )}
        {/* Desktop paging arrows — slim square border buttons at header right */}
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <ArrowButton
            dir="left"
            label="Scroll back"
            onClick={() => scroll(-1)}
            className={canLeft ? "" : "pointer-events-none opacity-25"}
          />
          <ArrowButton
            dir="right"
            label="Scroll forward"
            onClick={() => scroll(1)}
            className={canRight ? "" : "pointer-events-none opacity-25"}
          />
        </div>
      </header>

      <div className="relative">
        {/* Touch/small-screen paging — chevrons on row hover */}
        {hovering && canLeft && (
          <div className="absolute -left-2 top-0 z-20 flex h-full items-center md:hidden">
            <ArrowButton dir="left" label="Scroll back" onClick={() => scroll(-1)} />
          </div>
        )}
        <div
          ref={trackRef}
          className="scrollbar-none flex gap-3 overflow-x-auto scroll-smooth pb-2 pt-6"
          role="list"
        >
          {items.map((item, i) => (
            <div
              key={`${item.id.provider}:${item.id.value}`}
              data-card
              role="listitem"
              className="w-[37%] shrink-0 sm:w-[24%] md:w-[19%] lg:w-[15.5%] xl:w-[12.8%]"
            >
              <TitleCard item={item} rank={rankFrom != null ? rankFrom + i : undefined} />
            </div>
          ))}
        </div>
        {hovering && canRight && (
          <div className="absolute -right-2 top-0 z-20 flex h-full items-center md:hidden">
            <ArrowButton dir="right" label="Scroll forward" onClick={() => scroll(1)} />
          </div>
        )}
      </div>
    </section>
  );
}
