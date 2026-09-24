"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Cover } from "@/components/cover";
import { CheckIcon, InfoIcon, PlayIcon, XIcon } from "@/components/icons";
import { useMyList } from "@/lib/session";
import { api, mbUrl } from "@/lib/api";
import type { CatalogItem, MediaDetails } from "@/lib/types";

const EXPAND_SCALE = 2.05; // expanded panel width relative to the base card
const OPEN_DELAY = 250; // hover dwell before expanding
const CLOSE_DELAY = 150; // grace after the pointer leaves card/popover
const VIEWPORT_PAD = 12; // min gap between the popover and viewport edges

const PROVIDER_LABEL: Record<string, string> = {
  moviebox: "MOVIEBOX",
  fourkhdhub: "4KHDHUB",
  bdix_circleftp: "BDIX CIRCLEFTP",
  bdix_dhakaflix: "BDIX DHAKAFLIX",
  addons: "ADDON",
  anime: "ANIME",
  manga: "MANGA",
};

/** Mono meta line ("01 SEASONS · 2024" / "2024") shown under the title on hover. */
function metaLine(item: CatalogItem): string {
  const parts: string[] = [];
  if (item.media_type === "series") {
    parts.push(
      item.season_count != null && item.season_count > 0
        ? `${String(item.season_count).padStart(2, "0")} SEASONS`
        : "SERIES",
    );
    if (item.year) parts.push(item.year);
  } else if (item.media_type === "manga") {
    parts.push(item.year ?? "MANGA");
  } else {
    parts.push(item.year ?? "MOVIE");
  }
  return parts.join(" · ");
}

/** Mono identity strip for the expanded panel: year · seasons · provider. */
function expandedMetaLine(item: CatalogItem): string {
  const parts: string[] = [];
  if (item.year) parts.push(item.year);
  if (item.media_type === "series") {
    parts.push(
      item.season_count != null && item.season_count > 0
        ? `${String(item.season_count).padStart(2, "0")} SEASONS`
        : "SERIES",
    );
  }
  parts.push(PROVIDER_LABEL[item.id.provider] ?? item.id.provider.toUpperCase());
  return parts.join(" · ");
}

function PlusIcon({ width = 16, height = 16 }: { width?: number; height?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      width={width}
      height={height}
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export interface PopoverGeometry {
  /** Offset of the panel's left edge from the card's left edge (may be negative). */
  left: number;
  /** Offset of the panel's top edge from the card's top edge (may be negative). */
  top: number;
  /** Panel width in px. */
  width: number;
  /** Panel height in px (matches the base card so it never leaves the row). */
  height: number;
}

/**
 * Place the expanded panel for a card, in px relative to that card.
 *
 * The panel grows to 2.05x the card width and keeps the card's height, so it
 * can never bleed out of the row's clip box (the scrolling track), where an
 * absolutely positioned child would otherwise be cut off. It prefers to grow
 * rightwards; when the clip bounds or the viewport leave too little room it
 * flips to the left, and when neither side fits it pins to whichever side has
 * more room so it never spills past the closer edge. Vertically it sits level
 * with the card and only shifts when the card is itself clipped or half out of
 * the viewport.
 */
export function popoverGeometry({
  card,
  bounds,
  viewport,
}: {
  card: { left: number; right: number; top: number; width: number; height: number };
  bounds: { left: number; right: number; top: number };
  viewport: { width: number; height: number };
}): PopoverGeometry {
  const side =
    bounds.right > bounds.left ? bounds : { left: VIEWPORT_PAD, right: viewport.width - VIEWPORT_PAD };
  const width = Math.max(200, Math.round(card.width * EXPAND_SCALE));
  const height = Math.round(card.height);

  const roomRight = side.right - card.left;
  const roomLeft = card.right - side.left;
  let left: number;
  if (width <= roomRight) left = card.left;
  else if (width <= roomLeft) left = card.right - width;
  else if (roomLeft >= roomRight) left = card.right - Math.min(width, roomLeft);
  else left = card.left;

  // Slide up only as far as the row's own clip box allows: an expanded card that
  // is half off the bottom of the viewport uncovers its content, while a card
  // that is fully visible never moves.
  let top = card.top;
  if (top + height > viewport.height - VIEWPORT_PAD) {
    top = Math.max(bounds.top, viewport.height - VIEWPORT_PAD - height);
  }

  return { left: left - card.left, top: top - card.top, width, height };
}

export const TitleCard = memo(function TitleCard({
  item,
  rank,
  expandable = true,
}: {
  item: CatalogItem;
  rank?: number;
  expandable?: boolean;
}) {
  const myList = useMyList();
  const href = `/title/${item.id.provider}/${item.id.value}`;
  // Manga items have no video player — the primary action opens the reader.
  const watchHref =
    item.media_type === "manga"
      ? `/read/${item.id.provider}/${item.id.value}`
      : `/watch/${item.id.provider}/${item.id.value}`;
  // Poster URLs are either absolute (movie providers) or backend-relative
  // proxy paths (/api/manga/image?...) which need the /api/mb prefix.
  const posterSrc = item.poster_url
    ? item.poster_url.startsWith("/api/")
      ? mbUrl(item.poster_url)
      : item.poster_url
    : null;

  const [open, setOpen] = useState(false);
  const [geom, setGeom] = useState<PopoverGeometry | null>(null);
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [fetching, setFetching] = useState(false);
  const [busy, setBusy] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  /** True right after our own programmatic scrollIntoView so we don't self-close. */
  const suppressScrollUntil = useRef(0);
  /** True while we programmatically refocus the card link (Escape) — don't re-expand. */
  const suppressFocusOpen = useRef(false);
  /**
   * True after a close that leaves the pointer parked on the card (close button,
   * Escape). Chrome re-fires pointerenter for whatever sits under a stationary
   * cursor when the DOM changes, which would otherwise reopen the panel at once.
   */
  const holdClosed = useRef(false);

  const inMyList = myList.has(item.id.provider, item.id.value);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current != null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const doClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
    setGeom(null);
  }, [clearOpenTimer, clearCloseTimer]);

  /** Open after the hover dwell (used by pointer + focus-visible). */
  const openNow = useCallback(() => {
    if (!expandable) return;
    clearCloseTimer();
    if (openTimer.current != null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    setOpen(true);
  }, [expandable, clearCloseTimer]);

  const armOpen = useCallback(() => {
    if (!expandable || holdClosed.current || openTimer.current != null) return;
    clearCloseTimer();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, OPEN_DELAY);
  }, [expandable, clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    if (closeTimer.current != null) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setGeom(null);
    }, CLOSE_DELAY);
  }, [clearOpenTimer]);

  // Measure the card + viewport once we expand, then clamp the panel so it
  // never leaves the viewport (or an ancestor horizontal scroller) on either side.
  useEffect(() => {
    if (!open || !expandable) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Nearest ancestor that actually scrolls horizontally = the row's track.
    // Its padding box is the clip edge an expanded card must stay inside, so
    // nudge the track (never the page) until the base card is fully in view.
    let scroller: HTMLElement | null = wrap.parentElement;
    while (
      scroller &&
      scroller !== document.documentElement &&
      scroller !== document.body &&
      scroller.scrollWidth <= scroller.clientWidth + 2
    ) {
      scroller = scroller.parentElement;
    }
    const bounded = scroller !== document.documentElement && scroller !== document.body;
    if (scroller && bounded) {
      const sr = scroller.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      // "instant" overrides the track's CSS scroll-smooth so the geometry
      // measured below matches what the user sees right away.
      if (wr.left < sr.left) {
        scroller.scrollTo({ left: scroller.scrollLeft - (sr.left - wr.left), behavior: "instant" });
      } else if (wr.right > sr.right) {
        scroller.scrollTo({ left: scroller.scrollLeft + (wr.right - sr.right), behavior: "instant" });
      }
      suppressScrollUntil.current = performance.now() + 350;
    }

    const wrapRect = wrap.getBoundingClientRect();
    const r = scroller && bounded ? scroller.getBoundingClientRect() : null;
    const bounds = r
      ? { left: Math.max(r.left, VIEWPORT_PAD), right: Math.min(r.right, vw - VIEWPORT_PAD), top: r.top }
      : { left: VIEWPORT_PAD, right: vw - VIEWPORT_PAD, top: 0 };

    setGeom(
      popoverGeometry({
        card: {
          left: wrapRect.left,
          right: wrapRect.right,
          top: wrapRect.top,
          width: wrapRect.width,
          height: wrapRect.height,
        },
        bounds,
        viewport: { width: vw, height: vh },
      }),
    );
  }, [open, expandable]);

  // Fetch detail text for the popover (description + genres); graceful when
  // unavailable, aborted on close/unmount, cached after the first success.
  useEffect(() => {
    if (!open || !expandable) return;
    if (details) return;
    const ctrl = new AbortController();
    setFetching(true);
    api
      .details(item.id.provider, item.id.value)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        setDetails(res.details);
        setFetching(false);
      })
      .catch(() => {
        /* synopsis unavailable — the panel just hides the block */
        if (ctrl.signal.aborted) return;
        setFetching(false);
      });
    return () => ctrl.abort();
  }, [open, expandable, item, details]);

  // While open: close on page/row scroll (unless we caused it), resize,
  // outside pointer-down, Escape, or focus leaving the card+popover.
  useEffect(() => {
    if (!open || !expandable) return;
    const now = () => performance.now();
    const onScroll = () => {
      if (now() < suppressScrollUntil.current) return;
      doClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      suppressFocusOpen.current = true;
      holdClosed.current = true;
      doClose();
      requestAnimationFrame(() => linkRef.current?.focus({ preventScroll: true }));
      requestAnimationFrame(() => {
        suppressFocusOpen.current = false;
      });
    };
    const onDown = (e: PointerEvent) => {
      const wrap = wrapRef.current;
      if (wrap && e.target instanceof Node && !wrap.contains(e.target)) doClose();
    };
    const onResize = () => doClose();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, expandable, doClose]);

  const onFocusLeave = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!open) return;
    const wrap = wrapRef.current;
    const next = e.relatedTarget as Node | null;
    if (!wrap) return;
    if (!next || !wrap.contains(next)) doClose();
  };

  const toggleList = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await myList.toggle({
        provider: item.id.provider,
        id: item.id.value,
        title: item.title,
        poster: item.poster_url,
        mediaType: item.media_type,
        year: item.year,
      });
    } catch {
      /* anon/offline — the button stays idle */
    } finally {
      setBusy(false);
    }
  };

  // Play target improves once details load (series -> first episode).
  const playHref =
    open && details && details.media_type === "series"
      ? (() => {
          const s = details.seasons[0];
          const ep = s?.episodes?.[0];
          return s && ep
            ? `/watch/${details.id.provider}/${details.id.value}?s=${s.number}&e=${ep.number}`
            : watchHref;
        })()
      : watchHref;

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      style={open && expandable ? { zIndex: 40 } : undefined}
      onPointerEnter={(e) => {
        // Hover preview is a pointer affordance: touch taps go straight to the card.
        if (e.pointerType !== "touch") armOpen();
      }}
      onPointerLeave={() => {
        holdClosed.current = false;
        scheduleClose();
      }}
      onPointerDown={clearOpenTimer}
      onBlur={onFocusLeave}
    >
      <Link
        ref={linkRef}
        href={href}
        aria-label={item.title}
        aria-expanded={expandable && open ? true : undefined}
        onFocus={(e) => {
          if (suppressFocusOpen.current) return; // our own refocus after Escape/close
          holdClosed.current = false; // a real keyboard focus releases the hold
          if (expandable && !open && e.currentTarget.matches(":focus-visible")) {
            openNow();
          }
        }}
        className={`group relative block w-full shrink-0 cursor-pointer rounded-lg outline-none ring-1 ring-line transition duration-300 ease-out hover:z-10 hover:shadow-[0_10px_22px_rgba(0,0,0,0.35),0_0_22px_rgba(34,197,94,0.14)] hover:ring-brand/60 focus-visible:ring-2 focus-visible:ring-[#4ade80]/80 ${
          open ? "" : "hover:scale-[1.02]"
        }`}
      >
        <div className="tick-corners relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface">
          <Cover
            src={posterSrc}
            alt={item.title}
            className="transition duration-300 group-hover:scale-[1.04]"
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 13vw"
          />
          {/* Bottom gradient that hosts the hover meta line */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />

          {/* Rank chip — mono, top-left, catalog style */}
          {rank != null && (
            <span className="pointer-events-none absolute left-2 top-2 z-10 select-none rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] text-brand ring-1 ring-brand/25 backdrop-blur-sm">
              No. {String(rank).padStart(2, "0")}
            </span>
          )}

          {/* Play affordance — small square green chip that slides in top-right */}
          <span className="pointer-events-none absolute right-2 top-2 z-10 -translate-y-1.5 opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100">
            <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-brand text-black shadow-[0_0_16px_rgba(34,197,94,0.5)] ring-1 ring-black/40 transition duration-200 group-hover:bg-brand-hover">
              <PlayIcon width={13} height={13} className="translate-x-px" />
            </span>
          </span>

          {/* Bottom mono meta line (title + identity strip) */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 p-2.5 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <span className="block truncate text-[13px] font-semibold leading-tight text-white drop-shadow">
              {item.title}
            </span>
            <span className="mono-meta mt-1 block truncate text-[10px] uppercase tracking-[0.14em] text-zinc-300">
              {metaLine(item)}
            </span>
          </span>
        </div>
      </Link>

      {/* ------- Expanded preview popover ------- */}
      {expandable && open && geom && (
        <div
          role="group"
          aria-label={`${item.title} quick actions`}
          className="pointer-events-none absolute z-50 animate-fade-in overflow-hidden rounded-lg bg-[#151518] ring-1 ring-white/10 shadow-[0_24px_70px_rgba(0,0,0,0.85),0_0_34px_rgba(34,197,94,0.16)]"
          style={{ left: geom.left, top: geom.top, width: geom.width, height: geom.height }}
        >
          {/* Backdrop: the same poster artwork, top-cropped landscape, dimmed by
              a scrim. It stays a link to the title page so clicking the expanded
              artwork (which now covers the base card) still navigates. */}
          <Link
            href={href}
            aria-label={`Open ${item.title}`}
            className="pointer-events-auto absolute inset-0 block overflow-hidden bg-surface-2"
          >
            {posterSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterSrc}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover object-top"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-surface-2">
                <span className="text-2xl font-black text-brand/40">
                  {item.title.charAt(0)}
                </span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-black/20" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/70 to-transparent" />
          </Link>

          {/* Content, bottom-anchored over the artwork */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1.5 p-3">
            <div className="flex items-center gap-1.5">
              <Link
                href={playHref}
                aria-label={`Play ${item.title}`}
                className="btn-solid pointer-events-auto h-9 w-9 items-center justify-center rounded-lg p-0 shadow-[0_0_18px_rgba(34,197,94,0.45)]"
              >
                <PlayIcon width={14} height={14} className="translate-x-px" />
              </Link>
              <button
                onClick={() => void toggleList()}
                disabled={busy}
                aria-label={inMyList ? "Remove from My List" : "Add to My List"}
                aria-pressed={inMyList}
                title={inMyList ? "Remove from My List" : "Add to My List"}
                className={`btn-glass pointer-events-auto h-9 w-9 items-center justify-center rounded-lg p-0 ${
                  inMyList ? "bg-brand/15 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.45)]" : ""
                }`}
              >
                {inMyList ? (
                  <CheckIcon width={15} height={15} className="text-brand" />
                ) : (
                  <PlusIcon width={15} height={15} />
                )}
              </button>
              <Link
                href={href}
                aria-label={`More about ${item.title}`}
                className="btn-glass pointer-events-auto h-9 w-9 items-center justify-center rounded-lg p-0"
              >
                <InfoIcon width={14} height={14} />
              </Link>
            </div>

            <h3 className="truncate text-[15px] font-bold leading-tight text-white">
              {item.title}
            </h3>
            <p className="mono-meta truncate text-[10px] uppercase tracking-[0.14em] text-zinc-400">
              {expandedMetaLine(item)}
            </p>

            {details?.description ? (
              <p className="line-clamp-2 text-[12px] leading-snug text-zinc-300">
                {details.description}
              </p>
            ) : fetching ? (
              <div className="skeleton h-3 w-4/5 rounded-[3px]" />
            ) : null}

            {details && details.genres.length > 0 && (
              <div className="flex flex-wrap gap-1 overflow-hidden">
                {details.genres.slice(0, 3).map((g) => (
                  <span
                    key={g}
                    className="mono-meta rounded-[3px] bg-white/[0.08] px-1.5 py-px text-[9px] uppercase tracking-[0.12em] text-zinc-300 ring-1 ring-white/10"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Close */}
          <button
            onClick={() => {
              suppressFocusOpen.current = true;
              holdClosed.current = true;
              doClose();
              requestAnimationFrame(() => linkRef.current?.focus({ preventScroll: true }));
              requestAnimationFrame(() => {
                suppressFocusOpen.current = false;
              });
            }}
            aria-label="Close preview"
            className="pointer-events-auto absolute right-2 top-2 z-20 grid h-7 w-7 place-items-center rounded-md bg-black/50 text-zinc-300 ring-1 ring-white/15 backdrop-blur transition duration-150 hover:bg-black/75 hover:text-white"
          >
            <XIcon width={13} height={13} />
          </button>
        </div>
      )}
    </div>
  );
});
