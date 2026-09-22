"use client";

import Link from "next/link";
import { useState } from "react";
import { Cover } from "@/components/cover";
import { CheckIcon, ChevronDown, PlayIcon } from "@/components/icons";
import { useMyList } from "@/lib/session";
import { formatRuntime } from "@/lib/format";
import type { MediaDetails, ProviderId, Season } from "@/lib/types";

function catalogTag(provider: ProviderId, value: string): string {
  const prefix =
    provider === "moviebox" ? "MB" : provider === "fourkhdhub" ? "4K" : provider === "anime" ? "AL" : "CT";
  const trimmed = value.replace(/^mb-|^4k-|^bdix[-_]/i, "");
  return `${prefix}-${trimmed}`;
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      width={15}
      height={15}
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TitleDetail({ details }: { details: MediaDetails }) {
  const myList = useMyList();
  const [savingList, setSavingList] = useState(false);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const saved = myList.has(details.id.provider, details.id.value);
  const seasons = details.seasons;
  const activeSeason: Season | null = seasons[seasonIdx] ?? null;
  const isAnime = details.media_type === "anime";
  const isSeries = details.media_type === "series" || seasons.length > 0;
  const runtime = formatRuntime(details.duration);
  const episodeCount = seasons.reduce((n, s) => n + s.episodes.length, 0);
  const anime = details.anime ?? null;
  const animeSeasonText =
    anime && anime.season && anime.season_year != null
      ? `${anime.season.charAt(0)}${anime.season.slice(1).toLowerCase()} ${anime.season_year}`
      : details.tagline && isAnime
        ? details.tagline
        : null;
  const animeStatusText = anime?.status ? animeStatusLabel(anime.status) : null;
  const animeStudios =
    anime && anime.studios && anime.studios.length > 0
      ? anime.studios.join(", ")
      : details.director && isAnime
        ? details.director
        : null;

  const watchHref = (season: number, episode: number) =>
    `/watch/${details.id.provider}/${details.id.value}${
      isSeries || isAnime ? `?s=${season}&e=${episode}` : ""
    }`;

  const startHref = watchHref(activeSeason?.number ?? 1, activeSeason?.episodes[0]?.number ?? 1);

  const metaStrip: string[] = [];
  if (details.imdb_rating) metaStrip.push(`${details.imdb_rating}★`);
  if (isAnime && animeStatusText) metaStrip.push(animeStatusText);
  if (isAnime && animeSeasonText) metaStrip.push(animeSeasonText);
  if (details.year && !(isAnime && animeSeasonText)) metaStrip.push(details.year);
  if (!isAnime && runtime) metaStrip.push(runtime);
  if ((isSeries || isAnime) && episodeCount > 0) metaStrip.push(`${episodeCount} EPS`);

  return (
    <div className="pb-28">
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 scale-110">
          <Cover
            src={details.poster_url}
            alt=""
            className="object-cover blur-3xl opacity-40"
            sizes="100vw"
            priority
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-ink/40" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-ink/30" />
        {/* Faint green wash, top-right */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand/[0.06] blur-3xl" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/50 to-transparent" />

        <div className="relative z-10 mx-auto flex w-full max-w-[1560px] flex-col gap-10 px-5 pb-14 pt-24 md:flex-row md:items-end md:gap-12 md:px-8 md:pt-36 xl:px-12">
          {/* Poster — corner ticks + catalog tag below */}
          <div className="animate-fade-up w-44 shrink-0 sm:w-52 md:w-60">
            <div className="tick-corners relative overflow-hidden rounded-lg bg-surface ring-1 ring-line shadow-[0_24px_60px_rgba(0,0,0,0.6)]">
              <div className="aspect-[2/3] w-full">
                <Cover src={details.poster_url} alt={details.title} sizes="260px" priority />
              </div>
            </div>
            <p className="mono-meta mt-2.5 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              <span>{catalogTag(details.id.provider, details.id.value)}</span>
              <span className="text-zinc-600">{isAnime ? "ANIME" : isSeries ? "SERIES" : "FILM"}</span>
            </p>
          </div>

          {/* Info column */}
          <div className="animate-fade-up min-w-0 flex-1 space-y-5">
            <p className="eyebrow">
              {providerLabel(details.id.provider)} · {isAnime ? "Anime" : isSeries ? "Series" : "Film"}
            </p>

            <h1 className="display-title text-balance text-[clamp(2.2rem,5vw,4.6rem)]">
              {details.title}
            </h1>

            {/* Mono meta strip */}
            {metaStrip.length > 0 && (
              <p className="mono-meta text-[12px] uppercase tracking-[0.16em] text-zinc-400">
                {metaStrip.map((part, i) => (
                  <span key={part}>
                    {i > 0 && <span className="mx-2 text-zinc-600">·</span>}
                    <span className={part.endsWith("★") ? "text-brand" : ""}>{part}</span>
                  </span>
                ))}
              </p>
            )}

            {details.genres.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {details.genres.slice(0, 5).map((g) => (
                  <span key={g} className="chip mono-meta text-[11px] uppercase tracking-[0.08em] text-zinc-300">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {details.tagline && !(isAnime && animeSeasonText === details.tagline) && (
              <p className="border-l-2 border-brand/50 pl-3 text-sm italic leading-relaxed text-zinc-400">
                “{details.tagline}”
              </p>
            )}

            <p className="max-w-3xl text-[15px] leading-relaxed text-[#b4b4b8]">
              {details.description || "No synopsis available for this title yet."}
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href={startHref}
                className="btn-solid mono-meta px-7 py-3 text-[13px] font-bold uppercase tracking-[0.14em]"
              >
                <PlayIcon width={15} height={15} className="translate-x-px" />
                {isAnime ? "Start Watching" : isSeries ? "Start Series" : "Play"}
              </Link>
              <button
                onClick={() => {
                  if (savingList) return;
                  setSavingList(true);
                  void myList
                    .toggle({
                      provider: details.id.provider,
                      id: details.id.value,
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
                disabled={savingList}
                aria-label={saved ? "Remove from My List" : "Add to My List"}
                aria-pressed={saved}
                title={saved ? "Remove from My List" : "Add to My List"}
                className={`btn-glass mono-meta px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.14em] ${
                  saved ? "bg-brand/15 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.45)]" : ""
                }`}
              >
                {saved ? (
                  <CheckIcon width={15} height={15} className="text-brand" />
                ) : (
                  <PlusIcon />
                )}
                {saved ? "In My List" : "Add to My List"}
              </button>
            </div>

            {/* Definition rows — mono, under a hairline */}
            {(details.director || details.stars || animeStudios || animeSeasonText || animeStatusText) && (
              <dl className="space-y-2.5 border-t border-line pt-4">
                {animeStudios && (
                  <div className="flex gap-5">
                    <dt className="mono-meta w-20 shrink-0 pt-px text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Studio
                    </dt>
                    <dd className="min-w-0 text-[13px] leading-relaxed text-zinc-300">
                      {animeStudios}
                    </dd>
                  </div>
                )}
                {isAnime && animeSeasonText && (
                  <div className="flex gap-5">
                    <dt className="mono-meta w-20 shrink-0 pt-px text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Season
                    </dt>
                    <dd className="min-w-0 text-[13px] leading-relaxed text-zinc-300">
                      {animeSeasonText}
                    </dd>
                  </div>
                )}
                {animeStatusText && (
                  <div className="flex gap-5">
                    <dt className="mono-meta w-20 shrink-0 pt-px text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Status
                    </dt>
                    <dd className="min-w-0 text-[13px] leading-relaxed text-zinc-300">
                      {animeStatusText}
                    </dd>
                  </div>
                )}
                {!isAnime && details.director && (
                  <div className="flex gap-5">
                    <dt className="mono-meta w-20 shrink-0 pt-px text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Director
                    </dt>
                    <dd className="min-w-0 text-[13px] leading-relaxed text-zinc-300">
                      {details.director}
                    </dd>
                  </div>
                )}
                {details.stars && (
                  <div className="flex gap-5">
                    <dt className="mono-meta w-20 shrink-0 pt-px text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Cast
                    </dt>
                    <dd className="min-w-0 text-[13px] leading-relaxed text-zinc-300">
                      {details.stars}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Detail sections: same gutters as the hero ---------- */}
      <div className="mx-auto mt-12 w-full max-w-[1560px] space-y-12 px-5 md:px-8 xl:px-12">
        {isSeries && seasons.length > 0 && (
          <section aria-label="Episodes">
            <div className="mb-5 flex items-center gap-5">
              <div>
                <p className="eyebrow mb-1.5 flex items-center gap-2">
                  <span className="h-px w-5 bg-brand" />
                  {isAnime ? "Episode Track" : "Season Track"}
                </p>
                <h2 className="text-2xl font-black tracking-tight text-zinc-50">Episodes</h2>
              </div>
              {seasons.length > 1 && (
                <div className="ml-auto">
                  <SeasonPicker seasons={seasons} value={seasonIdx} onChange={setSeasonIdx} />
                </div>
              )}
            </div>

            <ol className="divide-y divide-line/70 border-y border-line">
              {activeSeason?.episodes.map((ep) => (
                <li key={`${ep.season}-${ep.number}`} className="group relative">
                  <Link
                    href={watchHref(ep.season, ep.number)}
                    className="flex items-center gap-4 px-2 py-3 transition duration-150 hover:bg-white/[0.04]"
                  >
                    {/* Left green tick on hover */}
                    <span className="pointer-events-none absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-brand opacity-0 shadow-[0_0_10px_rgba(34,197,94,0.9)] transition duration-150 group-hover:opacity-100" />
                    {/* Mono number square */}
                    <span className="mono-meta grid h-9 w-9 shrink-0 place-items-center rounded-[4px] border border-line text-[12px] font-bold text-zinc-400 transition duration-150 group-hover:border-brand/40 group-hover:text-brand">
                      {String(ep.number).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-zinc-100 transition duration-150 group-hover:text-white">
                      {ep.title ?? `Episode ${ep.number}`}
                    </span>
                    <span className="mono-meta hidden text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:block">
                      {String(ep.season).padStart(2, "0")} · {String(ep.number).padStart(2, "0")}
                    </span>
                    <ChevronRightSmall />
                  </Link>
                </li>
              ))}
            </ol>
            {activeSeason?.episodes.length === 0 && (
              <p className="py-8 text-center font-mono text-sm text-zinc-500">
                Episode list unavailable for this season.
              </p>
            )}
          </section>
        )}

        {details.dubs.length > 1 && (
          <section aria-label="Audio languages">
            <p className="eyebrow mb-3">Audio</p>
            <div className="flex flex-wrap gap-2">
              {details.dubs.map((dub) => (
                <span
                  key={dub.subject_id}
                  className="chip mono-meta text-[11px] uppercase tracking-[0.08em] text-zinc-300"
                >
                  {dub.language}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ChevronRightSmall() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 text-zinc-600 transition duration-200 group-hover:text-brand"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
function animeStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case "RELEASING":
      return "Currently Airing";
    case "FINISHED":
      return "Finished";
    case "NOT_YET_RELEASED":
      return "Not Yet Aired";
    case "CANCELLED":
      return "Cancelled";
    case "HIATUS":
      return "On Hiatus";
    default:
      return status;
  }
}

function providerLabel(p: ProviderId): string {
  switch (p) {
    case "moviebox":
      return "MovieBox";
    case "fourkhdhub":
      return "4KHDHub";
    case "bdix_circleftp":
      return "BDIX CircleFTP";
    case "bdix_dhakaflix":
      return "BDIX DhakaFlix";
    case "anime":
      return "AniList";
    default:
      return "Addon";
  }
}

function SeasonPicker({
  seasons,
  value,
  onChange,
}: {
  seasons: Season[];
  value: number;
  onChange: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = seasons[value];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="btn-glass mono-meta gap-2 px-3.5 py-2 text-[12px] font-semibold uppercase tracking-[0.12em]"
      >
        Season {current?.number}
        <ChevronDown
          width={14}
          height={14}
          className={`transition duration-200 ${open ? "rotate-180 text-brand" : ""}`}
        />
      </button>
      {open && (
        <>
          <button
            aria-label="Close season picker"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            aria-label="Seasons"
            className="absolute right-0 top-full z-20 mt-2 min-w-[200px] overflow-hidden rounded-lg border border-line bg-raised/95 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.7)] backdrop-blur"
          >
            {seasons.map((s, i) => (
              <button
                key={s.number}
                role="option"
                aria-selected={i === value}
                onClick={() => {
                  onChange(i);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-4 rounded-[4px] px-3 py-2 text-left text-sm transition duration-150 ${
                  i === value
                    ? "bg-brand/10 font-bold text-brand"
                    : "text-zinc-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="mono-meta tracking-[0.08em]">S{String(s.number).padStart(2, "0")}</span>
                <span className="text-xs font-normal text-zinc-500">
                  {s.episodes.length} eps
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
