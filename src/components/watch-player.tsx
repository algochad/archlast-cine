"use client";

// Type-only imports are safe for SSR (erased at compile time).
// Runtime imports are dynamic (inside callbacks) to avoid "self is not defined".
import type Hls from "hls.js";
import type dashjs from "dashjs";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, mbUrl, type TranscodeStateResponse } from "@/lib/api";
import {
  attachSubtitleTrack,
  ensureActiveCues,
  parseSubtitleCues,
  reattachSubtitleTrack,
  type SubtitleTrackState,
} from "@/lib/captions";
import { formatClock } from "@/lib/format";
import { getHistory } from "@/lib/history";
import { browserSupportsHevc, parseMpdDuration, pickPlayableManifest, rewriteRelativeTo, sniffHls } from "@/lib/playback";
import { clampSeekTarget, isSeekableDuration, resolveDisplayTime, seekProgressPct } from "@/lib/seek";
import { useMyList, useServerHistory, useSession } from "@/lib/session";
import type { MediaDetails, Release, StreamsResponse, SubtitleOption } from "@/lib/types";
import { ApiError } from "@/lib/types";
import { recordWatch, removeWatch, setWatchSyncTransport } from "@/lib/watch-sync";
import { ArrowLeft, CheckIcon, FullscreenIcon, FullscreenExitIcon, PlayIcon, Spinner, VolumeIcon, VolumeMuteIcon } from "@/components/icons";

type Provider = "moviebox" | "fourkhdhub" | "bdix_circleftp" | "bdix_dhakaflix" | "anime";

interface Props {
  provider: Provider;
  id: string;
  season: number;
  episode: number;
}

interface Loaded {
  streams: StreamsResponse;
  details: MediaDetails;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function WatchPlayer({ provider, id, season, episode }: Props) {
  const router = useRouter();
  // account session: drives server-side progress sync + the My List toggle
  const { status } = useSession();
  const myList = useMyList();
  const serverHistory = useServerHistory();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);

  // live-transcode (HLS fallback for HEVC-only sources)
  const hlsRef = useRef<Hls | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const transcodeSessionRef = useRef<string | null>(null);
  // the index URL of the stream currently bound to hls.js (needed to restore
  // playback when a remote seek is refused)
  const transcodeIndexUrlRef = useRef<string | null>(null);
  // bumped whenever the whole source is (re)started — in-flight async work
  // (e.g. a seek restart) checks it before touching playback state
  const sourceEpochRef = useRef(0);
  const watchdogFiredRef = useRef(false);
  const playingSinceRef = useRef(0);
  const playingRef = useRef(false);
  // Last (currentTime, timestamp) sample seen by the black-frame watchdog.
  const watchdogLastTimeRef = useRef<number | null>(null);
  const watchdogLastStampRef = useRef(0);
  // codec picture of the last sniffed manifest (DASH or HLS): null = unknown/fetch failed
  const hevcOnlyRef = useRef<boolean | null>(null);
  const transcodeActiveRef = useRef(false);
  const [transcodeActive, setTranscodeActiveState] = useState(false);
  // source the player is currently bound to (for the watchdog fallback)
  const currentSourceRef = useRef<string | null>(null);

  // Absolute-source timeline for the transcode (HLS live) path. The media
  // element only exposes the sliding live window (video.duration = window
  // length, currentTime = window-relative), so the true total comes from the
  // MPD / backend state and the window's start position is derived as
  // `totalDuration - windowLength` (recomputed every rAF frame).
  const totalDurationRef = useRef<number | null>(null);
  const manifestTotalRef = useRef<number | null>(null);
  const producedSecondsRef = useRef(0);
  const playbackOffsetRef = useRef(0);
  const resumePromptedRef = useRef(false);

  // imperative DOM refs for the 60fps timeline
  const seekRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef<HTMLSpanElement>(null);
  const playedFillRef = useRef<HTMLDivElement>(null);
  const bufferedFillRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<"loading" | "ready" | "playing" | "paused" | "error">("loading");
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [active, setActive] = useState<{ source: string; label: string; releaseKey: string } | null>(null);
  const [controls, setControls] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [resumeAsk, setResumeAsk] = useState<{ position: number } | null>(null);
  const [nextUp, setNextUp] = useState<{ season: number; episode: number; title: string } | null>(null);
  const [qualityChoices, setQualityChoices] = useState<{ label: string; release: Release }[]>([]);
  const [tick, setTick] = useState(0);
  // captions: available subtitle tracks (moviebox only) + the active pick
  const [subOptions, setSubOptions] = useState<SubtitleOption[]>([]);
  const [chosenSub, setChosenSub] = useState<SubtitleOption | null>(null);
  const [subsOpen, setSubsOpen] = useState(false);
  // remote (pipeline-restart) seek state
  const [remoteSeeking, setRemoteSeeking] = useState(false);
  const [seekNotice, setSeekNotice] = useState<string | null>(null);
  const subsMenuRef = useRef<HTMLDivElement>(null);

  const controlsTimer = useRef<number | null>(null);
  const volumeRef = useRef(volume);
  const nextRef = useRef(nextUp);
  const endedRef = useRef(false);
  // true while the user is dragging the seek bar (rAF must not fight the thumb)
  const draggingRef = useRef(false);
  // target of an in-flight direct seek: the rAF loop paints this instead of
  // currentTime until the browser lands, so the thumb holds instead of
  // rubberbanding to the old position. Cleared on seeked/land or supersede.
  const pendingSeekRef = useRef<number | null>(null);
  // Clearable id for the deferred pin release after `seeked` (a superseding
  // seek cancels the prior clear so rapid seeks resolve to the latest target).
  const pendingClearRef = useRef<number | null>(null);
  // Watchdog fallback when `seeking` fires but `seeked` never does: releases
  // a stuck pin after 8s so the thumb can't strand.
  const seekWatchdogRef = useRef<number | null>(null);
  // Latest remote-seek target queued while a restart is in flight (storm
  // guard: superseded targets collapse to the latest instead of dropping).
  const queuedRemoteSeekRef = useRef<number | null>(null);
  // Direct-seek target deferred until metadata makes the duration seekable
  // (first-seek fix: never clamp to 0 while duration is NaN/Inf/<=0).
  const deferredSeekRef = useRef<number | null>(null);
  const subTrackRef = useRef<SubtitleTrackState | null>(null);
  const chosenSubRef = useRef<SubtitleOption | null>(null);
  const remoteSeekBusyRef = useRef(false);
  // media-session seekto + resume route through the absolute seek dispatcher
  const seekAbsoluteRef = useRef<(absSeconds: number) => void>(() => undefined);
  // ---- seek-pin lifecycle --------------------------------------------------
  // An in-flight direct seek pins the timeline display at its target until the
  // browser lands. A superseding seek cancels the prior deferred clear, so
  // rapid seeks always resolve to the latest target; a watchdog releases a
  // stuck pin when `seeked` never fires.
  const cancelPinTimers = useCallback(() => {
    if (pendingClearRef.current != null) {
      window.clearTimeout(pendingClearRef.current);
      pendingClearRef.current = null;
    }
    if (seekWatchdogRef.current != null) {
      window.clearTimeout(seekWatchdogRef.current);
      seekWatchdogRef.current = null;
    }
  }, []);
  const pinSeekTarget = useCallback(
    (target: number) => {
      cancelPinTimers();
      pendingSeekRef.current = target;
      const pinned = target;
      seekWatchdogRef.current = window.setTimeout(() => {
        seekWatchdogRef.current = null;
        // Only release our own pin: a superseding seek or drag preview that
        // bypassed cancelPinTimers must not be cleared by a stale timer.
        if (pendingSeekRef.current === pinned) pendingSeekRef.current = null;
      }, 8000);
    },
    [cancelPinTimers],
  );
  /** Transient center-of-screen notice that auto-clears. */
  const flashNotice = useCallback((text: string) => {
    setSeekNotice(text);
    window.setTimeout(() => {
      setSeekNotice((cur) => (cur === text ? null : cur));
    }, 2000);
  }, []);

  // ---- account session -------------------------------------------------
  // Mirrors the (async) session status so callbacks bound to a single render
  // (rAF loop, media events, unmount cleanup) always see the current auth
  // state. Flipping to anon mid-watch simply degrades to local-only writes.
  const authedRef = useRef(false);
  // End-of-title cleanup, callable from the empty-deps rAF loop.
  const removeWatchRef = useRef<() => void>(() => undefined);
  // Server half of the progress bridge. The provider's record/remove are
  // stable callbacks, held in refs so the transport can be bound once while
  // still exercising the latest session state.
  const serverRecordRef = useRef(serverHistory.record);
  serverRecordRef.current = serverHistory.record;
  const serverRemoveRef = useRef(serverHistory.remove);
  serverRemoveRef.current = serverHistory.remove;

  const setTranscodeActive = useCallback((active: boolean) => {
    transcodeActiveRef.current = active;
    setTranscodeActiveState(active);
  }, []);

  const label = loaded
    ? `${loaded.details.title}${loaded.details.media_type === "series" && season > 0 ? ` · S${season} E${episode}` : ""}`
    : "Loading…";
  const authed = status === "authed";
  authedRef.current = authed;
  // "watched to the end" cleanup: local row always, server row when signed in
  removeWatchRef.current = () => removeWatch(provider, id, season, episode, authedRef.current);

  // Bridge progress writes into the account store for the player's lifetime.
  // Bound once — the provider's record/remove are stable callbacks — so no
  // effect re-subscribes as the account cache updates.
  useEffect(() => {
    setWatchSyncTransport({
      record: (patch) => void serverRecordRef.current(patch),
      remove: (entryProvider, entryId, entrySeason, entryEpisode) =>
        void serverRemoveRef.current(entryProvider, entryId, entrySeason, entryEpisode),
    });
    return () => setWatchSyncTransport(null);
  }, []);

  /** Absolute content position in seconds (transcode path maps the live window onto the true source timeline). */
  const absolutePosition = useCallback((): number => {
    const video = videoRef.current;
    const current = video?.currentTime ?? 0;
    if (!Number.isFinite(current)) return 0;
    const total = transcodeActiveRef.current ? totalDurationRef.current ?? manifestTotalRef.current : null;
    if (transcodeActiveRef.current && total != null) {
      const abs = playbackOffsetRef.current + current;
      return Math.min(Math.max(abs, 0), total);
    }
    return Math.max(current, 0);
  }, []);

  /** Duration of the whole title in seconds (total for transcode, media duration otherwise). */
  const absoluteDuration = useCallback((): number => {
    const total = transcodeActiveRef.current ? totalDurationRef.current ?? manifestTotalRef.current : null;
    if (total != null && Number.isFinite(total) && total > 0) return total;
    const video = videoRef.current;
    const d = video?.duration ?? 0;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }, []);

  /**
   * Snapshot current progress. Always written locally; when a session is
   * active the server upsert rides along (throttled unless `flush`, which the
   * pause / unmount paths use). Never blocks or fails playback.
   */
  const saveNow = useCallback(
    (flush = false) => {
      const video = videoRef.current;
      if (!video || endedRef.current) return;
      const dur = absoluteDuration();
      if (dur <= 0) return;
      recordWatch(
        {
          provider,
          id,
          title: loaded?.details.title ?? label.replace(/ · S\d+ E\d+$/, ""),
          poster: loaded?.details.poster_url ?? null,
          mediaType: loaded?.details.media_type ?? (season > 0 ? "series" : "movie"),
          year: loaded?.details.year ?? null,
          season,
          episode,
          position: absolutePosition(),
          duration: dur,
        },
        authedRef.current,
        flush,
      );
    },
    [provider, id, season, episode, loaded, label, absolutePosition, absoluteDuration],
  );

  // ---------------- media session (OS media keys + lock screen) ----------------
  const setupMediaSession = useCallback(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({
        title: label,
        artist: provider === "moviebox" ? "MovieBox" : "Stream",
      });
      const video = videoRef.current;
      if (!video) return;
      ms.setActionHandler("play", () => void video.play());
      ms.setActionHandler("pause", () => video.pause());
      ms.setActionHandler("seekto", (d) => {
        if (d.seekTime != null) seekAbsoluteRef.current(d.seekTime);
      });
    } catch {
      /* unsupported */
    }
  }, [label, provider]);

  // ---------------- source loading ----------------
  const teardown = useCallback(() => {
    // NB: the caption track is deliberately NOT torn down here — it is owned
    // by the user's subtitle selection and survives source switches (the same
    // video element keeps addTextTrack tracks across load()/src changes).
    // Invalidate any in-flight async work (e.g. a seek-restart poll) that
    // captured the previous source epoch.
    sourceEpochRef.current += 1;
    // stop the live transcode: poll, hls playback, session on the backend
    const hls = hlsRef.current;
    if (hls) {
      hlsRef.current = null;
      // Detach first so in-flight buffer callbacks stop touching the
      // element; destroy() then releases the engine. Separate try blocks:
      // detach throwing must not skip destroy (zombie engine keeps
      // appending to a dead SourceBuffer -> InvalidStateError spam).
      try {
        hls.detachMedia();
      } catch {
        /* already detached */
      }
      try {
        hls.destroy();
      } catch {
        /* already torn down */
      }
    }
    const session = transcodeSessionRef.current;
    if (session) {
      transcodeSessionRef.current = null;
      void api.transcodeDelete(session).catch(() => undefined);
    }
    setTranscodeActive(false);
    const dash = dashRef.current;
    if (dash) {
      dashRef.current = null;
      try {
        // attachView(null) unbinds the element synchronously; destroy() calls
        // reset() internally plus releases the singleton context. Separate
        // try blocks so a detach failure can't skip destroy (leaked engine
        // keeps firing SourceBuffer callbacks at the reused element).
        dash.attachView(null as unknown as HTMLElement);
      } catch {
        /* already detached */
      }
      try {
        dash.destroy();
      } catch {
        /* already torn down */
      }
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        /* already paused */
      }
      video.removeAttribute("src");
      video.load();
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    currentSourceRef.current = null;
    transcodeIndexUrlRef.current = null;
    remoteSeekBusyRef.current = false;
    queuedRemoteSeekRef.current = null;
    deferredSeekRef.current = null;
    if (pendingClearRef.current != null) {
      window.clearTimeout(pendingClearRef.current);
      pendingClearRef.current = null;
    }
    if (seekWatchdogRef.current != null) {
      window.clearTimeout(seekWatchdogRef.current);
      seekWatchdogRef.current = null;
    }
    pendingSeekRef.current = null;
    watchdogLastTimeRef.current = null;
    watchdogLastStampRef.current = 0;
    // reset the absolute-timeline model; a new source run re-derives it
    totalDurationRef.current = null;
    manifestTotalRef.current = null;
    producedSecondsRef.current = 0;
    playbackOffsetRef.current = 0;
    setSeekNotice(null);
  }, [setTranscodeActive]);

  // ---------------- captions ----------------
  /** Load the available subtitle options once per title (moviebox only). */
  const loadSubtitleOptions = useCallback(async () => {
    if (provider !== "moviebox") {
      setSubOptions([]);
      return;
    }
    try {
      const subs = await api.captions(id);
      setSubOptions(subs.subtitles);
    } catch {
      setSubOptions([]); // captions are optional
    }
  }, [provider, id]);

  /** Fetch + parse one subtitle file through the header-injecting proxy. */
  const fetchSubtitleText = useCallback(async (opt: SubtitleOption): Promise<string | null> => {
    let res: Response;
    try {
      res = await fetch(`/api/mb/proxy/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: opt.url, headers: [] }),
        cache: "no-store",
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return null;
    }
    if (typeof body !== "object" || body === null || !("ticket" in body)) return null;
    const ticket = body.ticket;
    if (typeof ticket !== "string" || !ticket) return null;
    try {
      const subRes = await fetch(`/api/proxy/${ticket}/`, { cache: "no-store" });
      if (!subRes.ok) return null;
      return await subRes.text();
    } catch {
      return null;
    }
  }, []);

  /** Cheap re-apply after source (re)starts — only when captions are on. */
  const reapplyCaptions = useCallback(() => {
    const video = videoRef.current;
    if (!video || !chosenSubRef.current) return;
    reattachSubtitleTrack(video, subTrackRef.current);
    ensureActiveCues(video, subTrackRef.current);
  }, []);

  /** (Re)attach a chosen option, or clear the track when opt is null ("Off"). */
  const applyChosenCaptions = useCallback(
    async (opt: SubtitleOption | null) => {
      const video = videoRef.current;
      subTrackRef.current?.cleanup();
      subTrackRef.current = null;
      if (!opt || !video) return;
      const text = await fetchSubtitleText(opt);
      if (text == null) return;
      const cues = parseSubtitleCues(text);
      if (!cues.length) return;
      if (chosenSubRef.current !== opt) return; // user switched during fetch
      subTrackRef.current = attachSubtitleTrack(video, opt.name, cues);
    },
    [fetchSubtitleText],
  );

  /** User picked an option (or Off) in the CC panel. */
  const chooseSubtitle = useCallback(
    (opt: SubtitleOption | null) => {
      chosenSubRef.current = opt;
      setChosenSub(opt);
      setSubsOpen(false);
      void applyChosenCaptions(opt);
    },
    [applyChosenCaptions],
  );

  // ---------------- HEVC fallback: live server-side transcode ----------------
  const ticketFromUrl = useCallback((sourceUrl: string): string | null => {
    const m = sourceUrl.match(/\/api\/proxy\/([0-9a-f]{16,40})\//i);
    return m ? m[1] : null;
  }, []);

  /** True when the HLS index is fetchable and lists at least one media segment. */
  const indexHasSegments = useCallback(async (indexUrl: string): Promise<boolean> => {
    try {
      const res = await fetch(indexUrl, { cache: "no-store" });
      if (!res.ok) return false;
      const text = await res.text();
      return text
        .split("\n")
        .some((line) => line.trim() !== "" && !line.trim().startsWith("#"));
    } catch {
      return false;
    }
  }, []);

  /** Fold a fresh /state response into the absolute-timeline refs. */
  const applyTranscodeState = useCallback((s: TranscodeStateResponse) => {
    if (typeof s.duration_seconds === "number" && s.duration_seconds > 0) {
      totalDurationRef.current = s.duration_seconds;
    }
    if (typeof s.produced_seconds === "number") {
      producedSecondsRef.current = s.produced_seconds;
    }
    // NOTE: playbackOffsetRef is deliberately NOT derived from produced
    // here. The HLS pipeline appends segments with timestamps starting at
    // its base (0, or the seek offset after a restart), so video.currentTime
    // is already content-absolute; the offset is the pipeline base and stays
    // constant until the next seek-restart. Deriving it from (produced -
    // element duration) oscillates by a window-length quantum every playlist
    // refresh — that jitter is what this avoids.
  }, []);

  /** Poll the transcode session until the first segment exists (~20s cap). */
  const waitForTranscode = useCallback(
    async (session: string, indexUrl: string): Promise<void> => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const state = await api.transcodeState(session);
        applyTranscodeState(state);
        if (!state.restarting && state.ready && state.segments >= 1) return;
        if (await indexHasSegments(indexUrl)) return;
        await delay(1500);
      }
      throw new Error("This title isn't available right now. Try again or pick another source.");
    },
    [indexHasSegments, applyTranscodeState],
  );

  /**
   * Destroy only the in-flight hls.js engine (used by the seek-restart path,
   * where the transcode session itself must keep living).
   */
  const destroyHlsOnly = useCallback(() => {
    const hls = hlsRef.current;
    hlsRef.current = null;
    if (hls) {
      try {
        hls.detachMedia();
      } catch {
        /* already detached */
      }
      try {
        hls.destroy();
      } catch {
        /* already torn down */
      }
    }
  }, []);

  const playHls = useCallback(
    async (indexUrl: string) => {
      const video = videoRef.current;
      if (!video) return;
      // Epoch at call time: the hls.js import below awaits, and a source
      // switch/teardown/unmount in between must not attach a zombie engine
      // to the (possibly reused) video element.
      const epoch = sourceEpochRef.current;
      transcodeIndexUrlRef.current = indexUrl;
      const startPlayback = () => {
        if (sourceEpochRef.current !== epoch || hlsRef.current == null) return;
        reapplyCaptions();
        window.setTimeout(() => {
          reapplyCaptions();
          ensureActiveCues(video, subTrackRef.current);
        }, 150);
        void video.play().catch(() => undefined);
      };
      // Exception: static import crashes SSR; load only when needed in browser
      const Hls = (await import("hls.js")).default;
      // A teardown while the import was in flight → abandon, don't attach.
      // NB: the transcodeActive guard lives in startTranscode's caller only —
      // direct HLS sources (anime HLS, non-HEVC DASH) play with transcode
      // inactive, so gating here strands them on the spinner forever.
      if (sourceEpochRef.current !== epoch) return;
      if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 40, backBufferLength: Infinity });
        hlsRef.current = hls;
        hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal: boolean; type: string }) => {
          if (!data.fatal) {
            // hls.js fires non-fatal BUFFER_STALLED_ERROR while it fills the
            // buffer after a seek jump; the engine recovers on its own.
            // Surfacing a spinner here fights the pending-seek pin and reads
            // as a rubberband. Only fatal errors tear down.
            return;
          }
          // A superseded engine's fatal error must not tear down the live one.
          if (hlsRef.current !== hls || sourceEpochRef.current !== epoch) return;
          teardown();
          setError("This title isn't available right now. Try again or pick another source.");
          setState("error");
        });
        hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
        hls.on(Hls.Events.LEVEL_UPDATED, () => {
          ensureActiveCues(video, subTrackRef.current);
        });
        hls.loadSource(indexUrl);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        const onMeta = () => {
          reapplyCaptions();
          video.removeEventListener("loadedmetadata", onMeta);
        };
        video.addEventListener("loadedmetadata", onMeta);
        video.src = indexUrl;
        video.load();
        startPlayback();
      }
    },
    [teardown, reapplyCaptions],
  );

  /** Start transcoding an HEVC-only source, then play the resulting HLS stream. */
  const startTranscode = useCallback(
    async (sourceUrl: string) => {
      const ticket = ticketFromUrl(sourceUrl);
      if (!ticket) {
        console.warn("[playback] undecodable video with no transcodable ticket; showing generic error");
        setError("This video can't play on this device right now. Try another source.");
        setState("error");
        return;
      }
      setError(null);
      setState("loading");
      setTranscodeActive(true);
      playbackOffsetRef.current = 0; // fresh pipeline: window starts at 0
      try {
        const started = await api.transcodeStart(ticket);
        transcodeSessionRef.current = started.session;
        const indexUrl = mbUrl(started.m3u8_url);
        await waitForTranscode(started.session, indexUrl);
        // torn down or switched to another source while waiting?
        if (!transcodeActiveRef.current || transcodeSessionRef.current !== started.session) return;
        transcodeIndexUrlRef.current = indexUrl;
        playHls(indexUrl);
      } catch (e) {
        setTranscodeActive(false);
        const session = transcodeSessionRef.current;
        transcodeSessionRef.current = null;
        transcodeIndexUrlRef.current = null;
        if (session) void api.transcodeDelete(session).catch(() => undefined);
        console.warn("[playback] transcode start failed:", e instanceof Error ? e.message : e);
        if (e instanceof ApiError && e.status === 503) {
          setError("This video can't play on this device right now. Try another source.");
        } else {
          setError("This title isn't available right now. Try again or pick another source.");
        }
        setState("error");
      }
    },
    [ticketFromUrl, waitForTranscode, playHls, setTranscodeActive],
  );

  const startSource = useCallback(
    async (wantResolution: number | null, candidateOrder: Release[]) => {
      resumePromptedRef.current = false;
      teardown();
      // Fresh codec picture for this source: a stale value from the previous
      // source would misroute the watchdog.
      hevcOnlyRef.current = null;
      watchdogFiredRef.current = false;
      watchdogLastTimeRef.current = null;
      watchdogLastStampRef.current = 0;
      setState("loading");
      setError(null);
      const video = videoRef.current;
      if (!video) return;

      let play;
      try {
        play = await api.play({
          provider,
          id,
          season,
          episode,
          resolution: wantResolution ?? undefined,
        });
      } catch (e) {
        // Fall back to a manual first-mirror source.
        const rel = candidateOrder[0];
        if (rel?.mirrors[0]) {
          const mirror = rel.mirrors[0];
          try {
            const t = await fetch("/api/mb/proxy/ticket", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: mirror.resolver_url, headers: mirror.headers }),
              cache: "no-store",
            });
            const { ticket } = (await t.json()) as { ticket: string };
            const origin = new URL(mirror.resolver_url);
            const playUrl = `/api/proxy/${ticket}/a${origin.pathname}${origin.search}`;
            currentSourceRef.current = playUrl;
            setActive({ source: playUrl, label: rel.filename, releaseKey: `${rel.provider}:${rel.filename}` });
            setState("ready");
            await video.play();
            return;
          } catch {
            /* fall through to error */
          }
        }
        if (provider === "anime") {
          console.warn("[playback] anime play failed:", e instanceof Error ? e.message : e);
          setError("This title isn't available right now. Try again or pick another source.");
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
        setState("error");
        return;
      }

      const source = play.play_url;
      currentSourceRef.current = source;
      setActive({
        source,
        label: play.release.filename,
        releaseKey: `${play.release.provider}:${play.release.filename}`,
      });
      const rel = play.release;

      const isDash =
        source.endsWith(".mpd") ||
        rel.quality?.toLowerCase().includes("multi") ||
        rel.mirrors.some((m) => m.resolver_url.includes(".mpd"));

      if (isDash) {
        // Sniff the manifest before dash.js: HEVC-family streams are undecodable
        // in Chromium/Linux → fall back to live transcode; mixed streams have
        // their HEVC representations stripped client-side.
        let manifestText: string | null = null;
        try {
          const res = await fetch(source, { cache: "no-store" });
          if (res.ok) manifestText = await res.text();
        } catch {
          console.warn("[playback] manifest sniff fetch failed; playing original URL with watchdog cover");
        }

        let dashSource = source;
        if (manifestText !== null) {
          const decision = pickPlayableManifest(manifestText, video);
          if (decision.mode === "transcode") {
            console.warn("[playback] HEVC-family video without a fallback for this browser; routing to transcode");
            // Remember the true source runtime from the MPD — the transcode
            // HLS window never exposes it through video.duration.
            const mpdTotal = parseMpdDuration(manifestText);
            if (mpdTotal != null) manifestTotalRef.current = mpdTotal;
            await startTranscode(source);
            return;
          }
          hevcOnlyRef.current = decision.hevcOnly;
          if (decision.stripped) {
            if (!/<Representation\b/i.test(decision.text)) {
              // Stripping left no video representations: the remainder would
              // play audio-only, so transcode instead of attaching it.
              console.warn("[playback] HEVC strip left zero video representations; routing to transcode");
              hevcOnlyRef.current = true;
              const mpdTotal = parseMpdDuration(manifestText);
              if (mpdTotal != null) manifestTotalRef.current = mpdTotal;
              await startTranscode(source);
              return;
            }
            // Relative segment references only resolve from the original
            // location, so rewrite them absolute before serving via Blob URL.
            const baseDir = source.slice(0, source.lastIndexOf("/") + 1);
            const rewritten = rewriteRelativeTo(baseDir, decision.text);
            const blob = new Blob([rewritten], { type: "application/dash+xml" });
            blobUrlRef.current = URL.createObjectURL(blob);
            dashSource = blobUrlRef.current;
          }
        }

        // Exception: static import crashes SSR; load only when needed in browser
        const dashModuleEpoch = sourceEpochRef.current;
        const dashjs = (await import("dashjs")).default;
        // A teardown while the import was in flight → don't create an engine
        // at all (it would bind the reused video element as a zombie).
        if (sourceEpochRef.current !== dashModuleEpoch) return;
        const dash = dashjs.MediaPlayer().create();
        dashRef.current = dash;
        // The teardown below detaches the video element synchronously and
        // destroys the player, but dash.js fires SourceBuffer callbacks from
        // its own timers — "getAllBufferRanges exception" / "append failed"
        // InvalidStateError noise keeps arriving from the dead engine and
        // Next's dev overlay relays every console.error as "[browser]".
        // Suppress internal error logging; fatal manifest/init failures
        // still surface through our own ERROR/PLAYBACK_ERROR handlers.
        try {
          // LOG_LEVEL_FATAL = 1: only fatal internal logs; the enum isn't
          // exported in the typings, so the literal stands in for it.
          dash.updateSettings({ debug: { logLevel: 1 } });
        } catch {
          /* older dash.js without updateSettings — leave logging as-is */
        }
        const fatal = (code: number | undefined) =>
          code != null && (code === 27 || code === 34 || code === 2 || code === 11);
        dash.on(dashjs.MediaPlayer.events.ERROR, (data: unknown) => {
          if (dashRef.current !== dash) return; // superseded engine — ignore
          const err = (data as { error?: { code?: number; message?: string } })?.error;
          if (err && (fatal(err.code) || /manifest|initialization/i.test(err.message ?? ""))) {
            setError("This title isn't available right now. Try again or pick another source.");
            setState("error");
          }
        });
        dash.on(dashjs.MediaPlayer.events.PLAYBACK_ERROR, () => {
          if (dashRef.current !== dash) return; // superseded engine — ignore
          setError("This title isn't available right now. Try again or pick another source.");
          setState("error");
        });
        try {
          if (sourceEpochRef.current !== dashModuleEpoch) return;
          dash.initialize(video, dashSource, true);
          dash.setAutoPlay(false);
          void video.play().catch(() => undefined);
        } catch (e) {
          console.warn("[playback] DASH initialization failed:", e instanceof Error ? e.message : e);
          setError("This title isn't available right now. Try again or pick another source.");
          setState("error");
          return;
        }
      } else {
        const isHls = source.endsWith(".m3u8") || source.includes(".m3u8?");
        if (isHls) {
          // Gate MSE-backed HLS the same as DASH: an HEVC-only master played
          // through hls.js on a browser without HEVC decode is the same
          // black-screen-with-audio failure. Native HLS (no MSE) is left
          // alone — the element either plays or reports an error itself.
          const hlsSniffEpoch = sourceEpochRef.current;
          let hlsText: string | null = null;
          try {
            const res = await fetch(source, { cache: "no-store" });
            if (res.ok) hlsText = await res.text();
          } catch {
            /* playlist unreadable — play with watchdog cover */
          }
          // A source switch/teardown while the sniff was in flight → abandon.
          if (sourceEpochRef.current !== hlsSniffEpoch) return;
          if (hlsText !== null) {
            const sniff = sniffHls(hlsText);
            hevcOnlyRef.current = sniff.videoCodecs.length ? sniff.hevcOnly : null;
            // Only the MSE path (hls.js) needs this gate: native HLS leaves
            // decode to the element, which errors instead of going black.
            const mseHls = typeof window !== "undefined" && window.MediaSource != null;
            if (sniff.hevcOnly && mseHls && !browserSupportsHevc(video)) {
              console.warn("[playback] HEVC-only HLS for this browser; routing to transcode");
              await startTranscode(source);
              return;
            }
          }
          void playHls(source);
        } else {
          video.src = source;
          video.load();
          void video.play().catch(() => undefined);
        }
      }

      reapplyCaptions();
      setState("ready");
    },
    [provider, id, season, episode, teardown, reapplyCaptions, startTranscode, playHls],
  );

  // ---------------- initial load ----------------
  const boot = useCallback(async () => {
    setState("loading");
    setError(null);
    void loadSubtitleOptions();
    try {
      // Streams are the hard requirement; details are cosmetic (title/poster).
      // An anipub numeric id (e.g. 8347) resolves streams but 404s details
      // (AniList-numeric then AllAnime-string lookups both miss), and a joint
      // Promise.all lets the details miss kill working playback. Load streams
      // first, then degrade to synthetic anime details on details-404.
      const streams = await api.streams(provider, id, season, episode);
      let details: MediaDetails;
      try {
        details = await api.details(provider, id).then((d) => d.details);
      } catch (e) {
        const detailsMissing = e instanceof ApiError && e.status === 404 && provider === "anime";
        if (!detailsMissing) throw e;
        console.warn("[playback] anime details 404; continuing with streams only:", id);
        details = {
          id: { provider, value: id },
          title: id,
          media_type: "anime" as const,
          year: null,
          description: null,
          tagline: null,
          imdb_rating: null,
          director: null,
          stars: null,
          prints: null,
          audios: null,
          poster_url: null,
          duration: null,
          genres: [],
          seasons:
            season > 0 && episode > 0
              ? [{ number: season, episodes: [{ season, number: episode, title: null as string | null }] }]
              : [],
          dubs: [],
          anime: null,
        };
      }
      setLoaded({ streams, details });
      const choices = streams.releases.filter((r) => r.mirrors.length > 0);
      if (!choices.length) {
        setError("This title isn't available right now. Try again or pick another source.");
        setState("error");
        return;
      }
      const labelOf = (r: Release) => {
        const multi =
          r.quality?.toLowerCase().includes("multi") ||
          r.filename.toLowerCase().includes("multi-res");
        return multi ? "Auto (adaptive)" : (r.quality ?? r.filename ?? `Source ${r.mirrors[0].label}`);
      };
      setQualityChoices(
        choices.map((r) => ({ label: labelOf(r), release: r })),
      );
      await startSource(null, choices);
    } catch (e) {
      if (provider === "anime") {
        console.warn("[playback] anime load failed:", e instanceof Error ? e.message : e);
        setError("This title isn't available right now. Try again or pick another source.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load playback sources");
      }
      setState("error");
    }
  }, [provider, id, season, episode, startSource, loadSubtitleOptions]);
  useEffect(() => {
    void boot();
    return () => {
      // Capture + flush the last position *before* the source is torn down
      // (teardown resets the media element, so a saveNow afterwards would see
      // no duration). Signed-in sessions get a final forced server upsert.
      saveNowRef.current?.(true);
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  // body lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ---------------- resume prompt ----------------
  // Resume source of record. Signed in: the account history snapshot (the
  // provider fetches it once per session) wins, local rows fill gaps.
  // Anonymous: the local store, exactly as before — no network.
  useEffect(() => {
    if (resumePromptedRef.current) return;
    if (state !== "ready" && state !== "playing" && state !== "paused") return;
    // The session settles async: wait for it (and its history snapshot) so a
    // signed-in account entry is never missed in favour of the local row.
    if (status === "loading" || !serverHistory.ready) return;
    // Same title identity as the local store key: provider + id + season + episode.
    const local = getHistory().find(
      (h) => h.provider === provider && h.id === id && h.season === season && h.episode === episode,
    );
    const server = serverHistory.entries.find(
      (h) => h.provider === provider && h.id === id && h.season === season && h.episode === episode,
    );
    const entry =
      status === "authed" && server
        ? { position: server.position, duration: server.duration, updated: server.updatedAt }
        : local;
    // Only offer to resume progress that predates this session: entries this
    // run keeps saving every ~10s and must never re-prompt mid-watch.
    if (
      entry &&
      entry.updated < Date.now() - 120_000 &&
      entry.position > 25 &&
      entry.duration > 0 &&
      entry.position / entry.duration < 0.98
    ) {
      resumePromptedRef.current = true;
      setResumeAsk({ position: entry.position });
    }
  }, [state, status, provider, id, season, episode, serverHistory.ready, serverHistory.entries]);

  const resume = (fromStart: boolean) => {
    const video = videoRef.current;
    const pos = resumeAsk?.position ?? 0;
    setResumeAsk(null);
    if (!video) return;
    if (!fromStart && pos > 0) {
      if (transcodeActiveRef.current) {
        // absolute source position → dispatch through the shared seek path
        seekAbsoluteRef.current(pos);
      } else {
        const trySeek = () => {
          video.removeEventListener("loadedmetadata", trySeek);
          const dur = video.duration;
          const target = clampSeekTarget(pos, dur);
          if (target == null) {
            // Duration not seekable yet: queue for the metadata drain instead
            // of clamping to 0 (first-seek race).
            deferredSeekRef.current = pos;
            flashNotice("Still loading — try again in a moment");
            return;
          }
          pinSeekTarget(target);
          try {
            video.currentTime = target;
          } catch {
            pendingSeekRef.current = null;
          }
        };
        video.addEventListener("loadedmetadata", trySeek);
        // Seeking before metadata is ready clamps to 0 — defer instead.
        if (video.readyState >= 1) trySeek();
      }
    }
    void video?.play().catch(() => undefined);
  };

  // ---------------- control visibility ----------------
  const pokeControls = useCallback(() => {
    setControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused) setControls(false);
    }, 3200);
  }, []);

  useEffect(() => {
    pokeControls();
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [pokeControls, state]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
    pokeControls();
  }, [pokeControls]);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (transcodeActiveRef.current) {
      const total = totalDurationRef.current ?? manifestTotalRef.current;
      if (!isSeekableDuration(total)) {
        // Total unknown yet: queue the relative intent for the metadata drain
        // instead of clamping to 0 (first-seek race).
        deferredSeekRef.current = absolutePosition() + delta;
        flashNotice("Still loading — try again in a moment");
        return;
      }
      const target = clampSeekTarget(absolutePosition() + delta, total);
      if (target == null) {
        flashNotice("Still loading — try again in a moment");
        return;
      }
      seekAbsoluteRef.current(target);
      pokeControls();
      return;
    }
    if (!isSeekableDuration(video.duration)) {
      // Duration unknown yet: defer the relative intent until metadata makes
      // the absolute target computable (never jump to 0).
      deferredSeekRef.current = video.currentTime + delta;
      flashNotice("Still loading — try again in a moment");
      return;
    }
    const target = clampSeekTarget(video.currentTime + delta, video.duration);
    if (target == null) {
      flashNotice("Still loading — try again in a moment");
      return;
    }
    pinSeekTarget(target);
    try {
      video.currentTime = target;
    } catch {
      pendingSeekRef.current = null;
    }
    pokeControls();
  }, [pokeControls, absolutePosition, pinSeekTarget, flashNotice]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (!video.muted && video.volume === 0) {
      video.volume = volumeRef.current || 1;
      setVolume(video.volume);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen().catch(() => undefined);
  }, []);

  /** Add/remove the title being watched from the account My List. */
  const toggleMyList = useCallback(() => {
    const details = loaded?.details;
    if (!details) return;
    void myList.toggle({
      provider,
      id,
      title: details.title,
      poster: details.poster_url,
      mediaType: details.media_type,
      year: details.year,
    });
  }, [loaded, myList, provider, id]);

  const onVolume = (v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    video.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
    volumeRef.current = v;
  };

  // ---------------- absolute seeking (transcode path) ----------------

  /**
   * Restart the transcode pipeline at an absolute source offset and resume on
   * the fresh playlist. The HLS engine is only torn down AFTER the backend
   * accepted the seek, so a refused request (409/422/network) leaves the
   * current stream playing untouched.
   */
  const remoteSeek = useCallback(
    async (absSeconds: number) => {
      const session = transcodeSessionRef.current;
      if (!session) return;
      if (remoteSeekBusyRef.current) {
        // Storm guard: collapse superseded targets to the latest instead of
        // dropping them — drained in `finally` once the restart settles.
        queuedRemoteSeekRef.current = absSeconds;
        return;
      }
      const total = totalDurationRef.current ?? manifestTotalRef.current;
      if (total != null && absSeconds >= total - 0.05) {
        flashNotice("End of video");
        return;
      }
      remoteSeekBusyRef.current = true;
      const epoch = sourceEpochRef.current;
      setRemoteSeeking(true);
      setControls(true);
      pokeControls();
      setSeekNotice(null);
      try {
        const started = await api.transcodeSeek(session, absSeconds);
        if (sourceEpochRef.current !== epoch || !transcodeActiveRef.current) return;
        if (typeof started.duration_seconds === "number" && started.duration_seconds > 0) {
          totalDurationRef.current = started.duration_seconds;
        }
        if (typeof started.produced_seconds === "number" && started.produced_seconds > 0) {
          producedSecondsRef.current = started.produced_seconds;
        } else {
          producedSecondsRef.current = absSeconds;
        }
        playbackOffsetRef.current = absSeconds; // new window begins at the seek point
        // Backend is wiping the old pipeline now — detach hls.js before the
        // old segments vanish, then wait out the restart.
        destroyHlsOnly();
        const indexUrl = mbUrl(started.m3u8_url);
        transcodeIndexUrlRef.current = indexUrl;
        setState("loading");
        setError(null);
        const deadline = Date.now() + 20_000;
        let ready = false;
        while (Date.now() < deadline && !ready) {
          if (sourceEpochRef.current !== epoch || !transcodeActiveRef.current) return;
          let state: TranscodeStateResponse;
          try {
            state = await api.transcodeState(session);
            applyTranscodeState(state);
            ready = !state.restarting && state.ready && state.segments >= 1;
          } catch {
            /* transient poll error — keep waiting */
          }
          if (!ready && (await indexHasSegments(indexUrl))) ready = true;
          if (!ready) await delay(1200);
        }
        if (sourceEpochRef.current !== epoch || !transcodeActiveRef.current) return;
        setRemoteSeeking(false);
        playHls(indexUrl);
        reapplyCaptions();
      } catch (e) {
        if (sourceEpochRef.current !== epoch) return;
        // Request was refused or never arrived: keep the previous stream.
        setRemoteSeeking(false);
        if (e instanceof ApiError && e.status === 422) {
          flashNotice("Past end of video");
        } else if (e instanceof ApiError && e.status === 409) {
          flashNotice("Seek already in progress");
        } else {
          flashNotice("Seek failed — stream unchanged");
        }
      } finally {
        if (sourceEpochRef.current === epoch) {
          remoteSeekBusyRef.current = false;
          // Drain the latest queued target (if any) through the shared
          // dispatcher so rapid seeks resolve to the latest request.
          const queued = queuedRemoteSeekRef.current;
          queuedRemoteSeekRef.current = null;
          if (queued != null && Number.isFinite(queued)) void seekAbsoluteRef.current(queued);
        }
      }
    },
    [flashNotice, pokeControls, destroyHlsOnly, applyTranscodeState, indexHasSegments, playHls, reapplyCaptions],
  );

  /**
   * Seek to an absolute source position. Media-seeks when the target already
   * sits inside the buffered live window; otherwise dispatches a remote
   * pipeline restart at that offset.
   */
  const seekAbsolute = useCallback(
    async (absSeconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      if (!Number.isFinite(absSeconds)) return;
      if (!transcodeActiveRef.current) {
        // First-seek race: duration is NaN/Inf until metadata loads, and the
        // old `video.duration || 0` clamp sent the first skip to 0 (start)
        // while the retry (duration known) landed. Defer instead of jumping.
        if (!isSeekableDuration(video.duration)) {
          deferredSeekRef.current = absSeconds;
          flashNotice("Still loading — try again in a moment");
          return;
        }
        const target = clampSeekTarget(absSeconds, video.duration);
        if (target == null) {
          flashNotice("Still loading — try again in a moment");
          return;
        }
        // Pin the thumb at the requested position while the browser buffers:
        // without this the rAF loop keeps painting currentTime (the old spot)
        // until the seek lands, which reads as a rubberband snap-back.
        pinSeekTarget(target);
        if (video.readyState < 1) {
          // Metadata parsed enough for duration but element not ready: the
          // assignment below would throw/clamp, so wait for loadedmetadata.
          deferredSeekRef.current = target;
          return;
        }
        try {
          video.currentTime = target;
        } catch {
          pendingSeekRef.current = null;
        }
        pokeControls();
        return;
      }
      const total = totalDurationRef.current ?? manifestTotalRef.current;
      if (!isSeekableDuration(total)) {
        deferredSeekRef.current = absSeconds;
        flashNotice("Still loading — try again in a moment");
        return;
      }
      const abs = clampSeekTarget(absSeconds, total);
      if (abs == null) {
        flashNotice("Still loading — try again in a moment");
        return;
      }
      if (remoteSeekBusyRef.current) {
        // A restart is in flight: collapse to the latest target (drained in
        // remoteSeek's finally) instead of dropping the request.
        queuedRemoteSeekRef.current = abs;
        return;
      }
      const offset = playbackOffsetRef.current;
      let bufferedEnd = video.currentTime;
      if (video.buffered.length > 0) bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const availableUntil = offset + bufferedEnd + 1.5;
      const windowStart = Math.max(offset, 0);
      if (abs <= availableUntil && abs >= windowStart - 1.5) {
        // within the retained live window → plain window-relative media seek
        const mediaTime = clampSeekTarget(abs - offset, video.duration);
        if (mediaTime == null) {
          deferredSeekRef.current = abs;
          flashNotice("Still loading — try again in a moment");
          return;
        }
        video.currentTime = mediaTime;
        pokeControls();
        return;
      }
      await remoteSeek(abs);
    },
    [pokeControls, remoteSeek, pinSeekTarget, flashNotice],
  );
  // keep the media-session / keyboard / resume handlers pointing at the
  // latest dispatcher without re-subscribing them on every render
  useEffect(() => {
    seekAbsoluteRef.current = seekAbsolute;
  });

  // ---------------- next episode -----------------
  const maybeNextEpisode = useCallback((): { season: number; episode: number; title: string } | null => {
    const details = loaded?.details;
    if (!details || details.media_type !== "series" || season === 0) return null;
    const seasons = details.seasons;
    const current = seasons.find((s) => s.number === season);
    if (!current) return null;
    const idx = current.episodes.findIndex((e) => e.number === episode);
    if (idx >= 0 && idx + 1 < current.episodes.length) {
      const next = current.episodes[idx + 1];
      return { season, episode: next.number, title: next.title ?? `Episode ${next.number}` };
    }
    const nextSeason = seasons.find((s) => s.number === season + 1);
    if (nextSeason && nextSeason.episodes.length > 0) {
      const first = nextSeason.episodes[0];
      return { season: nextSeason.number, episode: first.number, title: first.title ?? `Episode ${first.number}` };
    }
    return null;
  }, [loaded, season, episode]);

  // countdown for next-up
  const nextCountdown = useRef(10);
  const countdownTimer = useRef<number | null>(null);

  const showNextUp = useCallback((n: { season: number; episode: number; title: string } | null) => {
    nextRef.current = n;
    setNextUp(n);
  }, []);

  const maybeNextEpisodeRef = useRef(maybeNextEpisode);
  maybeNextEpisodeRef.current = maybeNextEpisode;
  const showNextUpRef = useRef(showNextUp);
  showNextUpRef.current = showNextUp;

  useEffect(() => {
    if (!nextUp) return;
    nextCountdown.current = 10;
    countdownTimer.current = window.setInterval(() => {
      nextCountdown.current -= 1;
      setTick((t) => t + 1);
      if (nextCountdown.current <= 0) {
        if (countdownTimer.current) clearInterval(countdownTimer.current);
        const n = nextRef.current;
        showNextUp(null);
        if (n) router.push(`/watch/${provider}/${id}?s=${n.season}&e=${n.episode}`);
      }
    }, 1000);
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, [nextUp, router, provider, id, showNextUp]);

  // ---------------- keyboard ----------------
  useEffect(() => {
    if (!subsOpen) return;
    const onDown = (ev: MouseEvent) => {
      const el = subsMenuRef.current;
      if (el && !el.contains(ev.target as Node)) setSubsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [subsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "SELECT") return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(-10);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          onVolume(Math.min(1, volumeRef.current + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          onVolume(Math.max(0, volumeRef.current - 0.1));
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "Escape":
          if (subsOpen) setSubsOpen(false);
          else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else if (nextUp) showNextUp(null);
          else if (resumeAsk) setResumeAsk(null);
          else router.back();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlay, seekBy, toggleMute, toggleFullscreen, nextUp, resumeAsk, router, subsOpen]);

  // ---------------- progress tick ----------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const loop = () => {
      const transcode = transcodeActiveRef.current;
      const total = transcode ? totalDurationRef.current ?? manifestTotalRef.current : null;
      const rawDuration = video.duration;
      const duration = transcode && total != null ? total : rawDuration;

      if (isSeekableDuration(duration)) {
        // Transcode path: the element only exposes the sliding live window, so
        // derive the absolute offset every frame and display the absolute
        // source position against the true total.
        let absTime = video.currentTime;
        const offset = playbackOffsetRef.current;
        if (transcode && total != null) {
          // playbackOffsetRef is updated once per /state sample (see
          // applyTranscodeState) and on seek-restart: the live window's start
          // in content terms is constant between those events, so the frame
          // loop only ever adds the continuous currentTime to it.
          absTime = Math.min(offset + video.currentTime, total);
          // A transcode that produced the whole title may never deliver an
          // ENDLIST, so the browser never fires `ended` — close that gap once.
          if (
            !endedRef.current &&
            !video.paused &&
            producedSecondsRef.current >= total &&
            absTime >= total - 1.5
          ) {
            endedRef.current = true;
            removeWatchRef.current();
            const next = maybeNextEpisodeRef.current();
            if (next) showNextUpRef.current({ ...next });
            else {
              setState("paused");
              setControls(true);
            }
          }
        }

        if (durationRef.current && Math.abs(Number(durationRef.current.dataset.d) - duration) > 0.5) {
          durationRef.current.dataset.d = String(duration);
          durationRef.current.textContent = formatClock(duration);
        }
        if (!draggingRef.current) {
          // (while the user drags the seek bar, the preview handlers own the
          // thumb/fill/time label and the rAF loop must not fight them)
          // An in-flight direct seek pins the display at its target until the
          // browser lands (see pendingSeekRef): painting currentTime meanwhile
          // is the rubberband — thumb snaps back to the old spot, then jumps.
          const pending = pendingSeekRef.current;
          const displayTime = resolveDisplayTime(pending, absTime, transcode);
          const pct = seekProgressPct(displayTime, duration);
          if (timeRef.current) timeRef.current.textContent = formatClock(displayTime);
          if (playedFillRef.current) playedFillRef.current.style.width = `${pct}%`;
          if (seekRef.current) {
            seekRef.current.max = String(Math.floor(duration));
            seekRef.current.value = String(Math.floor(displayTime));
            seekRef.current.style.setProperty("--progress", `${pct}%`);
          }
          // buffered range (last buffered segment, absolute on the transcode path)
          if (bufferedFillRef.current && video.buffered.length > 0) {
            const end = video.buffered.end(video.buffered.length - 1);
            const bufAbs = transcode && total != null ? Math.min(offset + end, total) : end;
            bufferedFillRef.current.style.width = `${seekProgressPct(bufAbs, duration)}%`;
          }
        }
      }
      requestAnimationFrame(loop);
    };
    const raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- periodic progress persistence ----------------
  useEffect(() => {
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && !endedRef.current) saveNow();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [saveNow]);

  // keep produced_seconds / duration_seconds fresh for the whole transcode run
  // (natural-end detection and total-duration bookkeeping)
  useEffect(() => {
    if (!transcodeActive) return;
    const poll = async () => {
      const session = transcodeSessionRef.current;
      if (!session) return;
      try {
        const st = await api.transcodeState(session);
        applyTranscodeState(st);
      } catch {
        /* session deleted / server restarting — nothing to fold */
      }
    };
    const t = window.setInterval(() => void poll(), 6_000);
    void poll();
    return () => window.clearInterval(t);
  }, [transcodeActive, applyTranscodeState]);

  // ---------------- player events ----------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => {
      endedRef.current = false;
      playingRef.current = true;
      playingSinceRef.current = Date.now();
      setState("playing");
      setControls(true);
      pokeControls();
      setupMediaSession();
    };
    const onPause = () => {
      playingRef.current = false;
      setState("paused");
      setControls(true);
      saveNow(true); // explicit pause flushes the server upsert
    };
    const onEnded = () => {
      playingRef.current = false;
      if (endedRef.current) return; // already handled by the transcode natural-end path
      endedRef.current = true;
      removeWatch(provider, id, season, episode, authedRef.current);
      const next = maybeNextEpisode();
      if (next) {
        showNextUp({ ...next });
      } else {
        setState("paused");
        setControls(true);
      }
    };
    const onError = () => {
      if (!video.error) return;
      // during a seek-restart the old source is intentionally detached and the
      // new one is being spun up — transient media errors are expected
      if (remoteSeekBusyRef.current) return;
      const code = video.error.code;
      if (code === 4) {
        setError("This video can't play on this device right now. Try another source.");
      } else {
        setError("This title isn't available right now. Try again or pick another source.");
      }
      setState("error");
    };
    const onVolumeChange = () => {
      setMuted(video.muted);
      setVolume(video.volume);
      volumeRef.current = video.volume;
    };
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    const onWaiting = () => {
      setBuffering(true);
      setControls(false);
    };
    const onPlaying = () => {
      setBuffering(false);
      // captions: cheap re-apply once playback actually starts (a fresh source
      // switch can leave the cue engine unmatching until then)
      reapplyCaptions();
      window.setTimeout(() => {
        ensureActiveCues(video, subTrackRef.current);
      }, 120);
    };
    // A direct seek landed (or finished erroring): release the display pin so
    // the rAF loop resumes painting currentTime from the new position. The
    // 1.5s grace covers hls.js buffer-append settling, where currentTime can
    // momentarily read the pre-seek value right after `seeked` fires. The
    // clear is stored so a superseding seek cancels it (rapid seeks resolve
    // to the latest target); the `seeking` watchdog below releases a stuck
    // pin when `seeked` never fires.
    const schedulePinClear = () => {
      if (pendingClearRef.current != null) window.clearTimeout(pendingClearRef.current);
      const pinned = pendingSeekRef.current;
      pendingClearRef.current = window.setTimeout(() => {
        pendingClearRef.current = null;
        if (pendingSeekRef.current === pinned) pendingSeekRef.current = null;
      }, 1500);
    };
    const armSeekWatchdog = () => {
      if (seekWatchdogRef.current != null) window.clearTimeout(seekWatchdogRef.current);
      const pinned = pendingSeekRef.current;
      seekWatchdogRef.current = window.setTimeout(() => {
        seekWatchdogRef.current = null;
        if (pendingSeekRef.current === pinned) pendingSeekRef.current = null;
      }, 8000);
    };
    const onSeeking = () => {
      if (pendingSeekRef.current != null) armSeekWatchdog();
    };
    const onSeeked = () => {
      if (seekWatchdogRef.current != null) {
        window.clearTimeout(seekWatchdogRef.current);
        seekWatchdogRef.current = null;
      }
      schedulePinClear();
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokeControls, saveNow, maybeNextEpisode, provider, id, season, episode, showNextUp]);
  // ---------------- deferred seek drain ----------------
  // First-seek fix: a seek requested while duration was unseekable (NaN/Inf)
  // is queued in deferredSeekRef instead of clamping to 0. Once metadata
  // makes the duration seekable, replay the latest queued target through the
  // shared dispatcher (which re-gates and pins it normally).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const drain = () => {
      const queued = deferredSeekRef.current;
      if (queued == null) return;
      const dur = transcodeActiveRef.current
        ? totalDurationRef.current ?? manifestTotalRef.current
        : video.duration;
      if (!isSeekableDuration(dur)) return;
      deferredSeekRef.current = null;
      void seekAbsoluteRef.current(queued);
    };
    video.addEventListener("loadedmetadata", drain);
    video.addEventListener("durationchange", drain);
    return () => {
      video.removeEventListener("loadedmetadata", drain);
      video.removeEventListener("durationchange", drain);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- watchdog: "playing but black" fallback ----------------
  // Covers DASH and MSE-backed HLS uniformly. Triggers only on the true
  // black-with-audio signature: the timeline is advancing (audio decodes)
  // while no video frame has decoded (videoWidth == 0) on a source whose
  // codecs are HEVC-family or unknown — then retries that source through
  // the live transcoder, once. A frozen timeline is a stall, not our case.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      if (watchdogFiredRef.current) return;
      if (transcodeActiveRef.current || !playingRef.current) return;
      if (Date.now() - playingSinceRef.current < 6000) return;
      if (video.videoWidth > 0 || video.paused) return;
      if (hevcOnlyRef.current === false) return; // decodable video — not our case
      const activeSource = currentSourceRef.current;
      if (!activeSource || !(dashRef.current || blobUrlRef.current || hlsRef.current)) return;
      // Require an advancing timeline: audio playing with no picture.
      const now = Date.now();
      const pos = video.currentTime;
      if (watchdogLastTimeRef.current == null || now - watchdogLastStampRef.current > 5000) {
        // (Re)baseline and re-check next tick instead of firing blind.
        watchdogLastTimeRef.current = pos;
        watchdogLastStampRef.current = now;
        return;
      }
      const advanced = pos > (watchdogLastTimeRef.current ?? pos);
      watchdogLastTimeRef.current = pos;
      watchdogLastStampRef.current = now;
      if (!advanced) return;
      watchdogFiredRef.current = true;
      teardown();
      setState("loading");
      setError(null);
      void startTranscode(activeSource);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [teardown, startTranscode]);

  /** Release of the seek bar: dispatch the chosen absolute position. */
  const commitSeekFromRange = (target: HTMLInputElement) => {
    draggingRef.current = false;
    const value = Number(target.value);
    if (!Number.isFinite(value)) return;
    void seekAbsoluteRef.current(value);
  };

  const showSpinner = state === "loading";
  const inMyList = myList.ready && myList.has(provider, id);
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-40 bg-black"
      onMouseMove={pokeControls}
      onTouchStart={pokeControls}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        playsInline
        onClick={togglePlay}
      />

      {/* top scrim + back */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${
          controls ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`absolute left-0 top-0 z-20 flex w-full items-center gap-4 p-5 transition-opacity duration-300 md:p-7 ${
          controls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          onClick={() => (fullscreen ? void document.exitFullscreen() : router.back())}
          aria-label="Back"
          className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
        >
          <ArrowLeft width={20} height={20} />
        </button>
        {authed && myList.ready && loaded && (
          <button
            onClick={toggleMyList}
            aria-label={inMyList ? "Remove from My List" : "Add to My List"}
            aria-pressed={inMyList}
            className={`mono-meta flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-xs font-bold tracking-[0.15em] ring-1 backdrop-blur transition ${
              inMyList
                ? "bg-brand/20 text-brand ring-brand/50 hover:bg-brand/30"
                : "bg-black/50 text-white ring-white/20 hover:bg-black/80"
            }`}
          >
            {inMyList ? (
              <CheckIcon width={16} height={16} />
            ) : (
              <svg
                viewBox="0 0 24 24"
                width={16}
                height={16}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
            <span>MY LIST</span>
          </button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-white md:text-xl">{label}</h1>
          <p className="flex items-center gap-2 text-xs text-zinc-400">
            <span>{provider === "moviebox" ? "MovieBox" : provider}</span>
            {active ? <span>· {active.label.replace(/\.(mp4|mkv|mpd)$/i, "")}</span> : null}
            {transcodeActive && (
              <span className="mono-meta rounded-[2px] border border-brand/40 bg-brand/10 px-1.5 py-px text-[9px] font-bold tracking-[0.2em] text-brand">
                TRANSCODE
              </span>
            )}
            {subOptions.length > 0 && (
              <span className={`mono-meta text-[11px] ${chosenSub ? "text-brand" : "text-zinc-500"}`}>
                {chosenSub ? `CC ${chosenSub.name}` : "CC OFF"}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* live-transcode status pill (always visible while transcoding) */}
      {transcodeActive && (
        <div className="pointer-events-none absolute right-4 top-4 z-30 flex items-center gap-2 border border-brand/50 bg-black/70 px-2.5 py-1.5 backdrop-blur md:right-7 md:top-7">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand shadow-[0_0_8px_var(--color-brand)]" />
          <span className="mono-meta text-[10px] font-bold tracking-[0.25em] text-brand">TRANSCODE</span>
        </div>
      )}

      {/* center play / spinner */}
      {(showSpinner || remoteSeeking) && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="flex flex-col items-center gap-4">
            <Spinner width={56} height={56} className="animate-spin text-brand" />
            {remoteSeeking && (
              <span className="mono-meta text-xs font-bold tracking-[0.3em] text-brand">SEEKING…</span>
            )}
          </div>
        </div>
      )}
      {buffering && state === "playing" && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <Spinner width={44} height={44} className="animate-spin text-white/70" />
        </div>
      )}
      {seekNotice && (
        <div className="pointer-events-none absolute inset-x-0 top-[34%] z-30 grid place-items-center">
          <span className="mono-meta rounded-[2px] border border-brand/60 bg-black/85 px-3 py-1.5 text-xs font-semibold tracking-[0.15em] text-brand backdrop-blur">
            {seekNotice}
          </span>
        </div>
      )}
      {state === "paused" && !nextUp && !resumeAsk && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 z-20 grid place-items-center"
        >
          <span className="grid h-24 w-24 place-items-center rounded-full bg-white/10 ring-1 ring-white/30 backdrop-blur-md transition hover:scale-105 hover:bg-white/20">
            <PlayIcon width={38} height={38} className="translate-x-1 text-white" />
          </span>
        </button>
      )}

      {/* error */}
      {state === "error" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/90 px-6 text-center backdrop-blur">
          <p className="text-4xl">⚠️</p>
          <h2 className="text-xl font-bold text-white">Playback unavailable</h2>
          <p className="max-w-md text-sm text-zinc-400">{error}</p>
          <div className="flex gap-3">
            <button
              onClick={() => void boot()}
              className="rounded-lg bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-zinc-200"
            >
              Retry
            </button>
            <button
              onClick={() => router.push(`/title/${provider}/${id}`)}
              className="rounded-lg bg-white/15 px-6 py-2.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/25"
            >
              Back to title
            </button>
          </div>
        </div>
      )}

      {/* resume prompt */}
      {resumeAsk && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-[min(92vw,430px)] rounded-2xl border border-white/10 bg-surface p-7 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Resume watching?</h3>
            <p className="mt-1 text-sm text-zinc-400">Continue from {formatClock(resumeAsk.position)}?</p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                onClick={() => resume(false)}
                className="rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-hover"
              >
                Resume from {formatClock(resumeAsk.position)}
              </button>
              <button
                onClick={() => resume(true)}
                className="rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                Start over
              </button>
            </div>
          </div>
        </div>
      )}

      {/* next-up */}
      {nextUp && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
          <div className="w-[min(92vw,560px)] overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-brand/25 to-transparent px-6 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Up next</p>
                <p className="mt-0.5 text-lg font-bold text-white">
                  S{nextUp.season} E{nextUp.episode} · {nextUp.title}
                </p>
              </div>
              <span className="text-sm font-semibold text-zinc-300">{Math.max(0, nextCountdown.current)}s</span>
            </div>
            <div className="flex gap-3 p-5">
              <button
                onClick={() => router.push(`/watch/${provider}/${id}?s=${nextUp.season}&e=${nextUp.episode}`)}
                className="flex-1 rounded-lg bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-zinc-200"
              >
                Play now
              </button>
              <button
                onClick={() => showNextUp(null)}
                className="flex-1 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* bottom controls */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${
          controls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="px-5 pb-2 md:px-7">
          <div className="relative mb-3 h-1.5 w-full rounded-full bg-white/20">
            <div ref={bufferedFillRef} className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: "0%" }} />
            <div ref={playedFillRef} className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: "0%" }} />
            <input
              ref={seekRef}
              type="range"
              min={0}
              max={0}
              step={1}
              defaultValue={0}
              aria-label="Seek"
              className="player-range absolute inset-0 h-full w-full cursor-pointer opacity-0"
              onPointerDown={(e) => {
                // Only the primary pointer owns the drag; a second finger/mouse
                // button must not hijack the preview or the pending pin.
                if (!e.isPrimary) return;
                if (e.pointerType === "mouse" && e.button !== 0) return;
                draggingRef.current = true;
                // A stale seek pin would yank the thumb back to the previous
                // target on release; the drag preview owns the thumb now.
                pendingSeekRef.current = null;
                try {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                } catch {
                  // Capture unavailable: pointerup/leave fallbacks below settle it.
                }
                pokeControls();
              }}
              onPointerUp={(e) => {
                if (!e.isPrimary) return;
                if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    // Already released — commit below still runs.
                  }
                }
                commitSeekFromRange(e.currentTarget);
              }}
              onLostPointerCapture={(e) => {
                // Capture loss without up/cancel: settle instead of stranding
                // draggingRef=true. No-op after normal release (flag cleared).
                if (draggingRef.current) commitSeekFromRange(e.currentTarget);
              }}
              onPointerLeave={(e) => {
                // No-capture fallback: release outside never fires pointerup
                // here, so buttons===0 means a missed release — commit last
                // preview. Buttons held = drag live outside; await up/cancel.
                if (draggingRef.current && e.buttons === 0 && e.isPrimary)
                  commitSeekFromRange(e.currentTarget);
              }}
              onPointerCancel={(e) => {
                if (!e.isPrimary) return;
                draggingRef.current = false;
                pendingSeekRef.current = null;
                // No commit: rAF repaints the true position next frame.
              }}
              onKeyDown={(e) => {
                // Never trap focus: Tab moves on natively; Escape blurs and
                // bubbles to the window handler (subs/fullscreen/back).
                // No stopPropagation/preventDefault by design.
                if (e.key === "Escape") e.currentTarget.blur();
              }}
              onChange={(e) => {
                const target = e.currentTarget;
                const max = Number(target.max || 0);
                const v = Number(target.value);
                if (!isSeekableDuration(max)) return;
                const pct = seekProgressPct(v, max);
                target.style.setProperty("--progress", `${pct}%`);
                if (playedFillRef.current) playedFillRef.current.style.width = `${pct}%`;
                if (timeRef.current) timeRef.current.textContent = formatClock(v);
                // keyboard-driven changes never see a pointer grab: commit them
                // (a keyboard change landing mid pointer-drag only previews;
                // the release commits the merged final value — no seek storm)
                if (!draggingRef.current) commitSeekFromRange(target);
              }}
            />
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <button onClick={togglePlay} aria-label={state === "playing" ? "Pause" : "Play"} className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/15">
              {state === "playing" ? (
                <svg viewBox="0 0 24 24" width={26} height={26} fill="currentColor"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" /></svg>
              ) : (
                <PlayIcon width={26} height={26} className="translate-x-0.5" />
              )}
            </button>
            <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/15">
              {muted || volume === 0 ? <VolumeMuteIcon width={24} height={24} /> : <VolumeIcon width={24} height={24} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(e) => onVolume(Number(e.target.value))}
              className="w-20 accent-brand"
            />
            {subOptions.length > 0 && (
              <div ref={subsMenuRef} className="relative">
                <button
                  onClick={() => {
                    setSubsOpen((open) => !open);
                    pokeControls();
                  }}
                  aria-label="Subtitles"
                  aria-expanded={subsOpen}
                  className={`mono-meta h-8 border px-2 text-xs font-bold tracking-[0.2em] transition ${
                    chosenSub
                      ? "border-brand bg-brand/15 text-brand"
                      : "border-white/25 bg-white/5 text-zinc-200 hover:bg-white/10"
                  }`}
                >
                  CC
                </button>
                {subsOpen && (
                  <div className="glass-panel absolute bottom-full right-0 z-30 mb-2 w-64">
                    <p className="eyebrow px-3 pb-1.5 pt-2.5 text-brand">SUBTITLES</p>
                    <ul className="max-h-72 overflow-y-auto pb-1">
                      <li className="hairline-t">
                        <button
                          onClick={() => chooseSubtitle(null)}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${
                            !chosenSub ? "text-brand" : "text-zinc-300"
                          }`}
                        >
                          <span className="mono-meta text-xs tracking-widest">OFF</span>
                          {!chosenSub && <CheckIcon width={14} height={14} />}
                        </button>
                      </li>
                      {subOptions.map((opt) => {
                        const isActive = chosenSub?.url === opt.url;
                        return (
                          <li key={opt.url} className="hairline-t">
                            <button
                              onClick={() => chooseSubtitle(opt)}
                              className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${
                                isActive ? "text-brand" : "text-zinc-200"
                              }`}
                            >
                              <span className="truncate text-xs">{opt.name}</span>
                              {isActive && <CheckIcon width={14} height={14} />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <span className="ml-1 text-sm tabular-nums text-zinc-300">
              <span ref={timeRef}>0:00</span>
              <span className="mx-1 text-zinc-600">/</span>
              <span ref={durationRef} data-d="-1">–:––</span>
            </span>

            {qualityChoices.length > 1 && (
              <div className="ml-auto hidden items-center gap-1.5 sm:flex">
                {transcodeActive && (
                  <span className="mono-meta flex items-center gap-1.5 rounded-[2px] border border-brand/40 bg-brand/10 px-2 py-1 text-[10px] font-bold tracking-[0.2em] text-brand">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-brand" />
                    TRANSCODE
                  </span>
                )}
                {qualityChoices.map((c) => {
                  const key = `${c.release.provider}:${c.release.filename}`;
                  const isActive = active?.releaseKey === key;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        const digits = c.release.quality?.match(/\d+/);
                        const others = qualityChoices.filter((x) => x !== c).map((x) => x.release);
                        void startSource(digits ? Number(digits[0]) : null, [c.release, ...others]);
                      }}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                        isActive ? "bg-brand text-white" : "bg-white/10 text-zinc-200 hover:bg-white/20"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="ml-auto flex items-center gap-2 sm:ml-0">
              <button onClick={toggleFullscreen} aria-label="Fullscreen" className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/15">
                {fullscreen ? <FullscreenExitIcon width={24} height={24} /> : <FullscreenIcon width={24} height={24} />}
              </button>
            </div>
          </div>
        </div>
        <div className="h-8 bg-gradient-to-t from-black/90 to-transparent" />
      </div>
    </div>
  );
}
