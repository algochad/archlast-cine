"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cover, mediaTypeLabel } from "@/components/cover";
import { CheckIcon, ChevronLeft, ChevronRight, PlayIcon, PlusIcon, StarIcon } from "@/components/icons";
import { backdropUrl, logoUrl } from "@/lib/artwork";
import { useMyList } from "@/lib/session";
import { titleHref, watchHref } from "@/lib/title-ref";
import type { CatalogItem } from "@/lib/types";

export interface HeroSlide {
  item: CatalogItem;
  rating?: number | null;
  overview?: string | null;
  genres?: string[];
  runtime?: string | null;
}

const ROTATE_MS = 9000;

function Backdrop({ slide, active, eager }: { slide: HeroSlide; active: boolean; eager: boolean }) {
  const { provider, value } = slide.item.id;
  const src = backdropUrl(provider, value);
  const [failed, setFailed] = useState(false);
  return (
    <div
      aria-hidden={!active}
      className={`absolute inset-0 transition-opacity duration-[900ms] ease-out ${active ? "opacity-100" : "opacity-0"}`}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={eager ? "high" : "auto"}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover object-[50%_22%] ${active ? "animate-kenburns" : ""}`}
        />
      ) : (
        <div className="absolute inset-0 scale-125 blur-2xl saturate-150">
          <Cover src={slide.item.poster_url} alt="" className="opacity-60" sizes="100vw" priority={eager} />
        </div>
      )}
    </div>
  );
}

function HeroTitle({ slide }: { slide: HeroSlide }) {
  const { provider, value } = slide.item.id;
  const src = logoUrl(provider, value);
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <h1 className="drop-shadow-[0_6px_30px_rgba(0,0,0,0.6)]">
        <span className="sr-only">{slide.item.title}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          onError={() => setFailed(true)}
          className="max-h-[7.5rem] w-auto max-w-[min(30rem,80vw)] object-contain object-left md:max-h-[10rem]"
        />
      </h1>
    );
  }
  return (
    <h1 className="display-title text-balance text-[clamp(2.4rem,6vw,5.4rem)]">{slide.item.title}</h1>
  );
}

export function Hero({ slides }: { slides: HeroSlide[] }) {
  const myList = useMyList();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const startedAt = useRef(0);
  const count = slides.length;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const go = useCallback(
    (next: number) => {
      startedAt.current = Date.now();
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (count < 2 || paused || reduceMotion) return;
    const timer = window.setTimeout(() => go(index + 1), ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [index, count, paused, reduceMotion, go]);

  if (!count) return null;
  const slide = slides[index];
  const { item } = slide;
  const bid = item.id;
  const saved = myList.has(bid.provider, bid.value);
  const metaBits = [
    slide.rating != null && slide.rating > 0 ? "rating" : null,
    item.year,
    mediaTypeLabel(item.media_type),
    slide.runtime ?? null,
  ].filter(Boolean) as string[];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured titles"
      className="relative isolate w-full overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="relative h-[clamp(560px,92svh,900px)] w-full">
        {slides.map((s, i) => (
          <Backdrop key={`${s.item.id.provider}:${s.item.id.value}`} slide={s} active={i === index} eager={i === 0} />
        ))}

        {/* Scrims: readable text on the left, seamless fade into the page below */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,9,18,0.94)_0%,rgba(6,9,18,0.62)_34%,rgba(6,9,18,0.08)_68%,transparent_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,#060912_2%,rgba(6,9,18,0.55)_26%,transparent_52%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink/80 to-transparent" />
        <div className="pointer-events-none absolute -left-40 bottom-0 h-[520px] w-[520px] rounded-full bg-brand/15 blur-[120px]" />

        <div className="page-shell absolute inset-x-0 bottom-0 z-10 pb-24 md:pb-28">
          <div key={`${bid.provider}:${bid.value}`} className="animate-fade-up max-w-[40rem] space-y-5">
            <p className="eyebrow flex items-center gap-2.5">
              <span className="h-px w-8 bg-gradient-to-r from-brand to-aqua" />
              Featured {item.media_type === "series" ? "series" : item.media_type === "anime" ? "anime" : "film"}
            </p>

            <HeroTitle slide={slide} />

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-zinc-300">
              {metaBits.map((bit, i) => (
                <span key={`${bit}-${i}`} className="flex items-center gap-3">
                  {i > 0 && <span className="h-1 w-1 rounded-full bg-zinc-500" />}
                  {bit === "rating" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-white ring-1 ring-white/15 backdrop-blur-md">
                      <StarIcon width={13} height={13} className="text-gold" />
                      {slide.rating!.toFixed(1)}
                    </span>
                  ) : (
                    <span>{bit}</span>
                  )}
                </span>
              ))}
              {slide.genres && slide.genres.length > 0 && (
                <span className="hidden items-center gap-3 md:flex">
                  <span className="h-1 w-1 rounded-full bg-zinc-500" />
                  <span className="text-zinc-400">{slide.genres.slice(0, 3).join(" · ")}</span>
                </span>
              )}
            </div>

            {slide.overview && (
              <p className="line-clamp-3 max-w-[34rem] text-[15px] leading-relaxed text-zinc-300 md:text-base">
                {slide.overview}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link href={watchHref(bid.provider, bid.value)} className="btn-solid px-8 py-3.5 text-[15px]">
                <PlayIcon width={18} height={18} className="translate-x-px" />
                Watch now
              </Link>
              <button
                type="button"
                disabled={savingList}
                aria-pressed={saved}
                onClick={() => {
                  if (savingList) return;
                  setSavingList(true);
                  void myList
                    .toggle({
                      provider: bid.provider,
                      id: bid.value,
                      title: item.title,
                      poster: item.poster_url,
                      mediaType: item.media_type,
                      year: item.year,
                    })
                    .catch(() => {
                      /* anon/offline — leave the state untouched */
                    })
                    .finally(() => setSavingList(false));
                }}
                className="btn-glass px-6 py-3.5 text-[15px]"
              >
                {saved ? <CheckIcon width={17} height={17} className="text-brand-hover" /> : <PlusIcon width={17} height={17} />}
                {saved ? "In My List" : "My List"}
              </button>
              <Link href={titleHref(bid.provider, bid.value)} className="btn-ghost px-5 py-3.5 text-[15px]">
                Details
                <ChevronRight width={17} height={17} />
              </Link>
            </div>
          </div>

          {count > 1 && (
            <div className="absolute bottom-28 right-[var(--page-gutter)] hidden items-center gap-5 md:flex">
              <span className="text-sm font-semibold tabular-nums text-zinc-400">
                <span className="text-white">{String(index + 1).padStart(2, "0")}</span> / {String(count).padStart(2, "0")}
              </span>
              <div className="flex items-center gap-2" role="tablist" aria-label="Choose featured title">
                {slides.map((s, i) => (
                  <button
                    key={`${s.item.id.provider}:${s.item.id.value}`}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    aria-label={`Show ${s.item.title}`}
                    onClick={() => go(i)}
                    className="group/seg relative h-6 w-10 outline-none"
                  >
                    <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-all group-hover/seg:h-[5px]">
                      {i === index && (
                        <span
                          key={`${index}-${paused}`}
                          className="absolute inset-0 origin-left rounded-full bg-white"
                          style={
                            reduceMotion || paused
                              ? undefined
                              : { animation: `progressFill ${ROTATE_MS}ms linear both` }
                          }
                        />
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Previous featured title"
                  onClick={() => go(index - 1)}
                  className="btn-glass h-10 w-10 !rounded-full p-0"
                >
                  <ChevronLeft width={18} height={18} />
                </button>
                <button
                  type="button"
                  aria-label="Next featured title"
                  onClick={() => go(index + 1)}
                  className="btn-glass h-10 w-10 !rounded-full p-0"
                >
                  <ChevronRight width={18} height={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        Slide {index + 1} of {count}: {item.title}
      </div>
    </section>
  );
}
