"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Cover, mediaTypeLabel } from "@/components/cover";
import { CheckIcon, ChevronRight, PlayIcon, PlusIcon, StarIcon } from "@/components/icons";
import type { WatchEntry } from "@/lib/account";
import { backdropUrl, episodeStillUrl, logoUrl } from "@/lib/artwork";
import { formatClock, formatRuntime } from "@/lib/format";
import { getHistory } from "@/lib/history";
import { mergeEntries } from "@/lib/history-merge";
import { useMyList, useServerHistory } from "@/lib/session";
import { watchHref } from "@/lib/title-ref";
import type { Episode, MediaDetails, Season } from "@/lib/types";

function animeStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case "RELEASING":
      return "Currently airing";
    case "FINISHED":
      return "Finished";
    case "NOT_YET_RELEASED":
      return "Not yet aired";
    case "CANCELLED":
      return "Cancelled";
    case "HIATUS":
      return "On hiatus";
    default:
      return status;
  }
}

function Backdrop({ details }: { details: MediaDetails }) {
  const did = details.id;
  const art = backdropUrl(did.provider, did.value);
  const [failed, setFailed] = useState(false);
  return art && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={art}
      alt=""
      fetchPriority="high"
      onError={() => setFailed(true)}
      className="animate-kenburns absolute inset-0 h-full w-full object-cover object-[50%_20%]"
    />
  ) : (
    <div className="absolute inset-0 scale-125 blur-2xl saturate-150">
      <Cover src={details.poster_url} alt="" className="opacity-60" sizes="100vw" priority />
    </div>
  );
}

function TitleArt({ details }: { details: MediaDetails }) {
  const did = details.id;
  const src = logoUrl(did.provider, did.value);
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <h1>
        <span className="sr-only">{details.title}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          onError={() => setFailed(true)}
          className="max-h-28 w-auto max-w-[min(28rem,80vw)] object-contain object-left drop-shadow-[0_6px_30px_rgba(0,0,0,0.6)] md:max-h-36"
        />
      </h1>
    );
  }
  return <h1 className="display-title text-balance text-[clamp(2.2rem,5vw,4.4rem)]">{details.title}</h1>;
}

function EpisodeCard({
  details,
  episode,
  progress,
}: {
  details: MediaDetails;
  episode: Episode;
  progress?: WatchEntry;
}) {
  const did = details.id;
  const still = episodeStillUrl(did.provider, did.value, episode.season, episode.number);
  const [failed, setFailed] = useState(false);
  const pct =
    progress && progress.duration > 0 ? Math.min(100, Math.max(0, (progress.position / progress.duration) * 100)) : 0;
  return (
    <Link
      href={watchHref(did.provider, did.value, { season: episode.season, episode: episode.number })}
      className="group relative block overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-line transition duration-300 hover:-translate-y-1 hover:ring-brand/60 hover:shadow-[0_18px_44px_rgba(0,0,0,0.5),0_0_30px_rgba(34,197,94,0.18)]"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[linear-gradient(160deg,#1b1b1e,#0d0d0e)]">
        {still && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={still}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center font-display text-6xl font-extrabold text-white/10">
            {episode.number}
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/15 backdrop-blur-md">
          E{episode.number}
        </span>
        <span className="absolute inset-0 grid place-items-center opacity-0 transition duration-300 group-hover:opacity-100">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-[linear-gradient(135deg,#4ade80,#16a34a)] text-white shadow-[0_8px_30px_rgba(34,197,94,0.6)]">
            <PlayIcon width={18} height={18} className="translate-x-px" />
          </span>
        </span>
        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div className="h-full bg-[linear-gradient(90deg,#22c55e,#86efac)]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="p-4">
        <p className="truncate text-[15px] font-semibold text-zinc-100 group-hover:text-white">
          {episode.title ?? `Episode ${episode.number}`}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Season {episode.season} · Episode {episode.number}
          {progress && progress.duration > 0 && pct < 98 && ` · ${formatClock(progress.duration - progress.position)} left`}
          {pct >= 98 && " · Watched"}
        </p>
      </div>
    </Link>
  );
}

function SeasonTabs({
  seasons,
  value,
  onChange,
}: {
  seasons: Season[];
  value: number;
  onChange: (i: number) => void;
}) {
  return (
    <div role="tablist" aria-label="Seasons" className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {seasons.map((s, i) => (
        <button
          key={s.number}
          type="button"
          role="tab"
          aria-selected={i === value}
          data-active={i === value}
          onClick={() => onChange(i)}
          className="chip shrink-0 !px-4 !py-2 text-sm"
        >
          Season {s.number}
          <span className="text-xs font-normal text-zinc-500">{s.episodes.length}</span>
        </button>
      ))}
    </div>
  );
}

export function TitleDetail({ details }: { details: MediaDetails }) {
  const myList = useMyList();
  const server = useServerHistory();
  const [local, setLocal] = useState<WatchEntry[]>([]);
  const [savingList, setSavingList] = useState(false);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const did = details.id;
  const saved = myList.has(did.provider, did.value);
  const seasons = details.seasons;
  const isAnime = details.media_type === "anime";
  const isSeries = details.media_type === "series" || seasons.length > 0;
  const activeSeason: Season | null = seasons[seasonIdx] ?? null;
  const episodeCount = seasons.reduce((n, s) => n + s.episodes.length, 0);
  const anime = details.anime ?? null;

  useEffect(() => {
    setLocal(getHistory().map((e): WatchEntry => ({ ...e, updatedAt: e.updated })));
  }, []);

  // Everything the viewer has watched of THIS title, newest first.
  const mine = useMemo(
    () =>
      mergeEntries(server.entries, local)
        .filter((e) => e.provider === did.provider && e.id === did.value)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [server.entries, local, did.provider, did.value],
  );
  const resume = mine.find((e) => !(e.duration > 0 && e.position / e.duration > 0.98)) ?? null;
  const progressByEp = useMemo(() => {
    const map = new Map<string, WatchEntry>();
    for (const e of mine) map.set(`${e.season}:${e.episode}`, e);
    return map;
  }, [mine]);

  // Land on the season being watched.
  useEffect(() => {
    if (!resume) return;
    const idx = seasons.findIndex((s) => s.number === resume.season);
    if (idx >= 0) setSeasonIdx(idx);
  }, [resume, seasons]);

  const first = activeSeason?.episodes[0] ?? seasons[0]?.episodes[0] ?? null;
  const startHref =
    isSeries || isAnime
      ? watchHref(did.provider, did.value, { season: first?.season ?? 1, episode: first?.number ?? 1 })
      : watchHref(did.provider, did.value);
  const resumeHref = resume
    ? watchHref(
        did.provider,
        did.value,
        isSeries || isAnime ? { season: resume.season, episode: resume.episode } : null,
      )
    : null;

  const runtime = formatRuntime(details.duration);
  const seasonText =
    anime?.season && anime.season_year != null
      ? `${anime.season.charAt(0)}${anime.season.slice(1).toLowerCase()} ${anime.season_year}`
      : null;
  const studios = anime?.studios && anime.studios.length > 0 ? anime.studios.join(", ") : null;
  const synopsis = details.description || "No synopsis is available for this title yet.";
  const longSynopsis = synopsis.length > 320;

  const facts: { label: string; value: string }[] = [];
  if (!isAnime && details.director) facts.push({ label: "Director", value: details.director });
  if (details.stars) facts.push({ label: "Cast", value: details.stars });
  if (studios) facts.push({ label: "Studio", value: studios });
  if (seasonText) facts.push({ label: "Season", value: seasonText });
  if (anime?.status) facts.push({ label: "Status", value: animeStatusLabel(anime.status) });

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="pb-24">
      {/* ---------- Hero ---------- */}
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0">
          <Backdrop details={details} />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,10,11,0.95)_0%,rgba(10,10,11,0.7)_38%,rgba(10,10,11,0.2)_75%,transparent_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(0deg,#0a0a0b_1%,rgba(10,10,11,0.7)_30%,transparent_65%)]" />
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink/85 to-transparent" />
        </div>

        <div className="page-shell relative flex flex-col gap-10 pb-14 pt-32 md:flex-row md:items-end md:gap-14 md:pb-16 md:pt-44">
          <div className="animate-fade-up hidden w-56 shrink-0 md:block lg:w-64">
            <div className="poster aspect-[2/3] overflow-hidden !rounded-[1.4rem] shadow-[0_30px_80px_rgba(0,0,0,0.7)]">
              <Cover src={details.poster_url} alt={details.title} sizes="260px" priority />
            </div>
          </div>

          <div className="animate-fade-up min-w-0 flex-1 space-y-5">
            <p className="eyebrow flex items-center gap-2.5">
              <span className="h-px w-8 bg-gradient-to-r from-brand to-aqua" />
              {mediaTypeLabel(details.media_type)}
            </p>

            <TitleArt details={details} />

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-zinc-300">
              {details.imdb_rating && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-white ring-1 ring-white/15 backdrop-blur-md">
                  <StarIcon width={13} height={13} className="text-gold" />
                  {details.imdb_rating}
                </span>
              )}
              {details.year && <span>{details.year}</span>}
              {runtime && !isAnime && (
                <>
                  <span className="h-1 w-1 rounded-full bg-zinc-500" />
                  <span>{runtime}</span>
                </>
              )}
              {(isSeries || isAnime) && episodeCount > 0 && (
                <>
                  <span className="h-1 w-1 rounded-full bg-zinc-500" />
                  <span>
                    {seasons.length > 1 ? `${seasons.length} seasons · ` : ""}
                    {episodeCount} episodes
                  </span>
                </>
              )}
            </div>

            {details.genres.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {details.genres.slice(0, 5).map((g) => (
                  <span key={g} className="chip">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {details.tagline && (
              <p className="border-l-2 border-brand/60 pl-3 text-sm italic leading-relaxed text-zinc-400">
                “{details.tagline}”
              </p>
            )}

            <div className="max-w-3xl">
              <p className={`text-[15px] leading-relaxed text-zinc-300 md:text-base ${expanded ? "" : "line-clamp-4"}`}>
                {synopsis}
              </p>
              {longSynopsis && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1.5 text-sm font-semibold text-brand-hover transition hover:text-white"
                >
                  {expanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {resumeHref ? (
                <>
                  <Link href={resumeHref} className="btn-solid px-8 py-3.5 text-[15px]">
                    <PlayIcon width={18} height={18} className="translate-x-px" />
                    {isSeries || isAnime ? `Resume S${resume!.season} · E${resume!.episode}` : "Resume"}
                  </Link>
                  <Link href={startHref} className="btn-glass px-6 py-3.5 text-[15px]">
                    {isSeries || isAnime ? "Start over" : "Play from start"}
                  </Link>
                </>
              ) : (
                <Link href={startHref} className="btn-solid px-8 py-3.5 text-[15px]">
                  <PlayIcon width={18} height={18} className="translate-x-px" />
                  {isSeries || isAnime ? "Start watching" : "Watch now"}
                </Link>
              )}
              <button
                type="button"
                disabled={savingList}
                aria-pressed={saved}
                onClick={() => {
                  if (savingList) return;
                  setSavingList(true);
                  void myList
                    .toggle({
                      provider: did.provider,
                      id: did.value,
                      title: details.title,
                      poster: details.poster_url,
                      mediaType: details.media_type,
                      year: details.year,
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
              <button type="button" onClick={() => void share()} className="btn-ghost px-5 py-3.5 text-[15px]">
                {copied ? "Link copied" : "Share"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Details ---------- */}
      <div className="page-shell mt-6 space-y-14">
        {facts.length > 0 && (
          <dl className="grid gap-x-12 gap-y-5 border-y border-line py-7 sm:grid-cols-2">
            {facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{f.label}</dt>
                <dd className="mt-1.5 text-[15px] leading-relaxed text-zinc-200">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {isSeries && seasons.length > 0 && (
          <section aria-label="Episodes">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <h2 className="section-title text-[1.6rem] md:text-[1.9rem]">Episodes</h2>
              {seasons.length > 1 && <SeasonTabs seasons={seasons} value={seasonIdx} onChange={setSeasonIdx} />}
            </div>
            <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {activeSeason?.episodes.map((ep) => (
                <li key={`${ep.season}-${ep.number}`}>
                  <EpisodeCard details={details} episode={ep} progress={progressByEp.get(`${ep.season}:${ep.number}`)} />
                </li>
              ))}
            </ol>
            {activeSeason?.episodes.length === 0 && (
              <p className="py-10 text-center text-sm text-zinc-500">The episode list isn’t available for this season.</p>
            )}
          </section>
        )}

        {details.dubs.length > 1 && (
          <section aria-label="Audio languages">
            <h2 className="section-title mb-4 text-xl">Audio languages</h2>
            <div className="flex flex-wrap gap-2">
              {details.dubs.map((dub) => (
                <span key={dub.subject_id} className="chip">
                  {dub.language}
                </span>
              ))}
            </div>
          </section>
        )}

        <Link href="/search" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-400 transition hover:text-white">
          Keep exploring <ChevronRight width={16} height={16} />
        </Link>
      </div>
    </div>
  );
}
