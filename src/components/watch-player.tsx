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
  parseAssCues,
  parseSubtitleCues,
  parseTtmlCues,
  reattachSubtitleTrack,
  shiftCues,
  type SubtitleCue,
  type SubtitleTrackState,
} from "@/lib/captions";
import { formatClock, formatRemaining } from "@/lib/format";
import { getHistory, isComplete } from "@/lib/history";
import { browserSupportsHevc, parseMpdDuration, pickPlayableManifest, rewriteRelativeTo, sniffHls, sniffManifest, sniffSubtitles } from "@/lib/playback";
import { applyScrubSensitivity, chapterLeftPct, chapterWidthPct, clampSeekTarget, isSeekableDuration, resolveDisplayTime, seekProgressPct, resolveSeekStep } from "@/lib/seek";
import { useMyList, useServerHistory, useSession } from "@/lib/session";
import type { Chapter, MediaDetails, Release, StreamsResponse, SubtitleOption } from "@/lib/types";
import { ApiError } from "@/lib/types";
import { recordWatch, removeWatch, setWatchSyncTransport } from "@/lib/watch-sync";
import { ArrowLeft, AspectIcon, BoostIcon, CastIcon, CcIcon, CheckIcon, ForwardIcon, FullscreenIcon, FullscreenExitIcon, GearIcon, LockIcon, NextEpIcon, PipIcon, PlayIcon, PrevEpIcon, ReplayIcon, RewindIcon, Spinner, StatsIcon, UnlockIcon, VolumeIcon, VolumeMuteIcon } from "@/components/icons";
import { nextEpisode, prevEpisode } from "@/lib/episode-nav";
import { getPrefs, setPrefs, subscribePrefs } from "@/lib/player-prefs";
import { clampRate, frameStep, nearestPreset, SPEED_PRESETS } from "@/lib/playback-rate";
import type { AspectMode, BackBuffer, FilterMode, HoldBoostRate, SeekStep, TimeMode } from "@/lib/player-prefs";
import { StatsOverlay } from "@/components/StatsOverlay";
import { sampleStats, type StatsSnapshot } from "@/lib/stats";
import { bufferTargetFor, estimate, type BandwidthSample } from "@/lib/bandwidth";
import { useDismissable } from "@/hooks/use-dismissable";
import { useGestures } from "@/hooks/use-gestures";
import { SubtitleOverlay } from "@/components/SubtitleOverlay";
import { DEFAULT_SUB_STYLE, coerceSubStyle, styleToCssVars, type SubStyle } from "@/lib/sub-style";
import { createSmartSpeed, type SmartSpeedHandle } from "@/lib/smart-speed";
import { findThumb, parseThumbsVtt, type ThumbCue } from "@/lib/thumbs";
import { attachJassub, destroyJassub } from "@/lib/jassub";
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
  // fatal playlist-load retries while ffmpeg warms the transcode playlist
  const transcodeRetryRef = useRef(0);
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
  const bwSamplesRef = useRef<BandwidthSample[]>([]);
  const lastBwEstimateRef = useRef<number>(0);
  const lastAppliedTargetRef = useRef<number | null>(null);
  const lastTargetChangeAtRef = useRef<number>(0);
  const bwTickRef = useRef<number | null>(null);
  const startSourceRef = useRef<((wantResolution: number | null, candidateOrder: Release[]) => Promise<void>) | null>(null);
  const heapWarnedRef = useRef(false);
  const excludedLabelsRef = useRef<Set<string>>(new Set());
  const failoverPendingRef = useRef(false);
  const lastFailoverAtRef = useRef(0);

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
  const [volumeBoost, setVolumeBoost] = useState(false);
  const [normalizeOn, setNormalizeOn] = useState(false);
  const [volPopoverOpen, setVolPopoverOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const volMenuRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const compRef = useRef<DynamicsCompressorNode | null>(null);
  const graphReadyRef = useRef(false);
  const volumeBoostRef = useRef(false);
  const normalizeGainRef = useRef(false);
  const [resumeAsk, setResumeAsk] = useState<{ position: number } | null>(null);
  const [nextUp, setNextUp] = useState<{ season: number; episode: number; title: string } | null>(null);
  const [qualityChoices, setQualityChoices] = useState<{ label: string; release: Release }[]>([]);
  const [tick, setTick] = useState(0);
  // captions: available subtitle tracks (api + manifest) + the active pick
  const [subOptions, setSubOptions] = useState<SubtitleOption[]>([]);
  const [chosenSub, setChosenSub] = useState<SubtitleOption | null>(null);
  const [subsOpen, setSubsOpen] = useState(false);
  // capability gating: null = unknown/loading, false = provider hides CC entirely
  const [supportsSubs, setSupportsSubs] = useState<boolean | null>(null);
  const supportsSubsRef = useRef<boolean | null>(null);
  supportsSubsRef.current = supportsSubs;
  const healthFetchedRef = useRef(false);
  // side-load hidden file input + local cues that survive teardown
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const localCuesRef = useRef<SubtitleOption | null>(null);
  // loaded/active refs for stale-free caption loading (used before ensureSubtitleCap defined)
  const loadedRef = useRef<Loaded | null>(null);
  const activeRef = useRef(active);
  useEffect(() => { loadedRef.current = loaded; }, [loaded]);
  useEffect(() => { activeRef.current = active; }, [active]);
  const [remoteSeeking, setRemoteSeeking] = useState(false);
  const [seekNotice, setSeekNotice] = useState<string | null>(null);
  const subsMenuRef = useRef<HTMLDivElement>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const [playbackRate, setPlaybackRateState] = useState<number>(() => {
    try { return clampRate(getPrefs().playbackRate); } catch { return 1; }
  });
  const [pitchLock, setPitchLockState] = useState<boolean>(() => {
    try { return getPrefs().pitchLock; } catch { return true; }
  });
  const pitchLockRef = useRef(pitchLock);
  pitchLockRef.current = pitchLock;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const frameStepWarnedRef = useRef(false);
  const [smartSpeed, setSmartSpeedState] = useState<boolean>(() => { try { return getPrefs().smartSpeed; } catch { return false; } });
  const smartSpeedRef = useRef(smartSpeed);
  smartSpeedRef.current = smartSpeed;
  const smartHandleRef = useRef<SmartSpeedHandle | null>(null);
  // rate/persist debounce: a slider drag fires dozens of changes per second,
  // so the pref write trails the last move instead of landing on each one.
  const ratePersistTimerRef = useRef<number | null>(null);
  // Safari spells it webkitPreservesPitch; feature-detect both so a pitch-lock
  // toggle is never a silent no-op on older WebKit.
  const applyPreservesPitch = useCallback((video: HTMLVideoElement, lock: boolean) => {
    try { (video as unknown as { preservesPitch?: boolean }).preservesPitch = lock; } catch {}
    try {
      const webkit = video as unknown as { webkitPreservesPitch?: boolean };
      if ("webkitPreservesPitch" in video) webkit.webkitPreservesPitch = lock;
    } catch {}
  }, []);
  /** Re-apply rate + pitch after a source (re)bind: load() resets both. */
  const restorePlaybackRate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try { video.playbackRate = clampRate(playbackRateRef.current); } catch {}
    applyPreservesPitch(video, pitchLockRef.current);
  }, [applyPreservesPitch]);
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false);
  const episodeDrawerRef = useRef<HTMLDivElement>(null);
  const [activeSeasonTab, setActiveSeasonTab] = useState<number | null>(null);
  const lastChosenSubRef = useRef<SubtitleOption | null>(null);
  // Dual subtitles (P2)
  const dualSubRef = useRef<SubtitleOption | null>(null);
  const chosenSub2Ref = useRef<SubtitleOption | null>(null);
  const [chosenSub2, setChosenSub2] = useState<SubtitleOption | null>(null);
  const [dualSubs, setDualSubsState] = useState<boolean>(() => { try { return getPrefs().dualSubs; } catch { return false; } });
  const dualSubsRef2 = useRef(dualSubs);
  dualSubsRef2.current = dualSubs;
  const dualTrackRef = useRef<SubtitleTrackState | null>(null);
  // subtitle offset + style (P2)
  const [subOffsetMs, setSubOffsetMs] = useState<number>(() => { try { return getPrefs().subOffsetMs; } catch { return 0; } });
  const [subOffsetMs2, setSubOffsetMs2] = useState<number>(() => { try { return getPrefs().subOffsetMs2; } catch { return 0; } });
  const subOffsetMsRef = useRef(subOffsetMs);
  subOffsetMsRef.current = subOffsetMs;
  const subOffsetMs2Ref = useRef(subOffsetMs2);
  subOffsetMs2Ref.current = subOffsetMs2;
  const [subStyle, setSubStyleState] = useState<SubStyle>(() => { try { return coerceSubStyle(getPrefs().subStyle); } catch { return DEFAULT_SUB_STYLE; } });
  const subStyleRef = useRef(subStyle);
  subStyleRef.current = subStyle;
  const [subFilter, setSubFilterState] = useState<'all'|'signs'>(() => { try { return getPrefs().subFilter; } catch { return 'all'; } });
  const subFilterRef = useRef(subFilter);
  subFilterRef.current = subFilter;
  // overlay clock: rAF subscription for dual/ASS scheduling
  const [overlayNow, setOverlayNow] = useState(0);
  const overlayNowRef = useRef(0);
  // cue cache for overlay rendering
  const [primaryCues, setPrimaryCues] = useState<SubtitleCue[]>([]);
  const primaryCuesRef = useRef<SubtitleCue[]>([]);
  // keep ref in sync with state for fast access in callbacks
  // (state drives render, ref drives logic)
  const [secondaryCues, setSecondaryCues] = useState<SubtitleCue[]>([]);
  const secondaryCuesRef = useRef<SubtitleCue[]>([]);
  const setPrimaryCuesSync = (cues: SubtitleCue[]) => { primaryCuesRef.current = cues; setPrimaryCues(cues); };
  const setSecondaryCuesSync = (cues: SubtitleCue[]) => { secondaryCuesRef.current = cues; setSecondaryCues(cues); };
  // P4: word lookup (pause + token selection only, no dictionary fetch)
  const [lookup, setLookup] = useState<{ word: string; cueText: string } | null>(null);
  const jassubAssRef = useRef<string | null>(null);
  const jassubActiveRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchProvider, setSearchProvider] = useState<'opensubtitles'|'subscene'|'aniskip'|'jimaku'>('opensubtitles');
  const [searchResults, setSearchResults] = useState<SubtitleOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [autoplay, setAutoplay] = useState<boolean>(() => {
    try { return getPrefs().autoplay; } catch { return true; }
  });
  const [autoplayDelay, setAutoplayDelay] = useState<number>(() => {
    try { return getPrefs().autoplayDelay; } catch { return 10; }
  });
  const [skipChapter, setSkipChapter] = useState<Chapter | null>(null);
  // P1System — screen lock + aspect + filter + stats + PiP
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const lockTapCountRef = useRef(0);
  const lockTapTimerRef = useRef<number | null>(null);
  const lockHoldTimerRef = useRef<number | null>(null);
  const lockHintTimerRef = useRef<number | null>(null);
  const [lockHint, setLockHint] = useState(false);
  const [aspectModeState, setAspectModeState] = useState<AspectMode>(() => {
    try { return getPrefs().aspectMode; } catch { return "contain"; }
  });
  const [filterMode, setFilterMode] = useState<FilterMode>(() => {
    try { return getPrefs().filter; } catch { return "none"; }
  });
  const [nightDim, setNightDimState] = useState<number>(() => {
    try { return getPrefs().nightDim; } catch { return 0; }
  });
  const [statsOpen, setStatsOpen] = useState<boolean>(() => {
    try { return getPrefs().statsOpen; } catch { return false; }
  });
  const statsSnapshotRef = useRef<StatsSnapshot>({ fps: null, bitrate: null, codec: null, buffered: 0, dropped: 0, resolution: "—" });
  const [statsTick, setStatsTick] = useState(0);
  const statsTimerRef = useRef<number | null>(null);
  const [pipActive, setPipActive] = useState(false);
  const [aspectOpen, setAspectOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const aspectMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const dimmerRef = useRef<HTMLDivElement>(null);
  // P3 gesture brightness + hold boost + side flash
  const [brightness, setBrightnessState] = useState<number>(() => {
    try { return getPrefs().brightness; } catch { return 1; }
  });
  const brightnessRef = useRef(brightness);
  brightnessRef.current = brightness;
  const [sideFlash, setSideFlash] = useState<"left" | "right" | null>(null);
  const sideFlashTimerRef = useRef<number | null>(null);
  const prevRateRef = useRef<number | null>(null);
  const boostActiveRef = useRef(false);
  const pinchAppliedRef = useRef<AspectMode | null>(null);
  const gestureVolumeStartRef = useRef<number | null>(null);
  const gestureBrightnessStartRef = useRef<number | null>(null);
  // P1Seek — seek step + time mode (direct + transcode, frame-accurate via refs)
  const [seekStep, setSeekStepState] = useState<SeekStep>(() => {
    try { return resolveSeekStep(getPrefs().seekStep); } catch { return 10; }
  });
  const seekStepRef = useRef(seekStep);
  seekStepRef.current = seekStep;
  const [timeMode, setTimeModeState] = useState<TimeMode>(() => {
    try {
      const m = getPrefs().timeMode;
      return m === 'elapsed' || m === 'remaining' ? m : 'elapsed';
    } catch { return 'elapsed'; }
  });
  const timeModeRef = useRef(timeMode);
  timeModeRef.current = timeMode;
  // P3Scrub — fine-scrub + hover tooltip + sub-parse worker (separate concerns, shared refs)
  const seekWrapRef = useRef<HTMLDivElement>(null);
  const scrubTooltipRef = useRef<HTMLDivElement>(null);
  const scrubTooltipImgRef = useRef<HTMLDivElement>(null);
  const thumbCuesRef = useRef<ThumbCue[]>([]);
  const thumbBaseRef = useRef<string | null>(null);
  const thumbLoadedRef = useRef(false);
  const scrubStartXRef = useRef<number | null>(null);
  const scrubStartYRef = useRef<number | null>(null);
  const scrubGrabTimeRef = useRef<number | null>(null);
  const scrubModeRef = useRef<'normal' | 'fine' | 'ultra'>('normal');
  const subParseWorkerRef = useRef<Worker | null>(null);
  const subParseReqIdRef = useRef(0);
  const subParsePendingRef = useRef<Map<number, (cues: SubtitleCue[]) => void>>(new Map());



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
  // ---- P3 buffer/ABR helpers (low-level, no startSource dep) ----
  const checkHeapAndPruneInternal = useCallback(() => {
    try {
      const perf = performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
      const mem = perf.memory;
      if (!mem || !Number.isFinite(mem.usedJSHeapSize) || !Number.isFinite(mem.jsHeapSizeLimit)) return;
      if (mem.usedJSHeapSize > 0.8 * mem.jsHeapSizeLimit) {
        if (heapWarnedRef.current) return;
        heapWarnedRef.current = true;
        flashNotice("Memory saver");
        window.setTimeout(() => {
          heapWarnedRef.current = false;
        }, 30000);
        const h = hlsRef.current;
        if (h) {
          try {
            const v = videoRef.current;
            if (v && Number.isFinite(v.currentTime)) {
              (h.config as unknown as { backBufferLength: number }).backBufferLength = 15;
            }
          } catch {}
        }
      }
    } catch {}
  }, [flashNotice]);

  const persistLastBps = useCallback((bps: number) => {
    if (!Number.isFinite(bps) || bps <= 0) return;
    lastBwEstimateRef.current = bps;
    try {
      const cur = getPrefs().lastBps;
      if (Math.abs(cur - bps) / Math.max(cur, 1) < 0.15) return;
      setPrefs({ lastBps: Math.round(bps) });
    } catch {}
  }, []);

  const applyBufferTarget = useCallback(
    (bps: number) => {
      if (!Number.isFinite(bps) || bps <= 0) return;
      const target = bufferTargetFor(bps);
      const now = Date.now();
      const last = lastAppliedTargetRef.current;
      const lastAt = lastTargetChangeAtRef.current;
      if (last != null && last === target) return;
      if (last != null && now - lastAt < 5000) return;
      lastAppliedTargetRef.current = target;
      lastTargetChangeAtRef.current = now;
      const h = hlsRef.current;
      if (h) {
        try {
          (h.config as unknown as { maxBufferLength: number }).maxBufferLength = target;
        } catch {}
      }
      const dash = dashRef.current;
      if (dash) {
        try {
          let keep: number;
          try {
            const b = getPrefs().backBuffer as BackBuffer;
            keep = b === 0 ? 30 : b;
          } catch {
            keep = 30;
          }
          dash.updateSettings({
            streaming: { buffer: { stableBufferTime: target / 2, bufferToKeep: keep } },
          });
        } catch {}
      }
    },
    [],
  );

  const applyBackBufferPref = useCallback((b: BackBuffer) => {
    const len = b === 0 ? Infinity : b;
    const h = hlsRef.current;
    if (h) {
      try {
        (h.config as unknown as { backBufferLength: number }).backBufferLength = len;
      } catch {}
    }
    const dash = dashRef.current;
    if (dash) {
      try {
        const keep = b === 0 ? 30 : b;
        const cur = lastAppliedTargetRef.current ?? bufferTargetFor(lastBwEstimateRef.current || getPrefs().lastBps);
        dash.updateSettings({
          streaming: { buffer: { stableBufferTime: cur / 2, bufferToKeep: keep } },
        });
      } catch {}
    }
    checkHeapAndPruneInternal();
  }, [checkHeapAndPruneInternal]);

  const pushBwSample = useCallback(
    (sample: BandwidthSample) => {
      if (!sample || typeof sample.bytes !== "number" || typeof sample.ms !== "number") return;
      if (!Number.isFinite(sample.bytes) || !Number.isFinite(sample.ms)) return;
      if (sample.bytes <= 0 || sample.ms <= 0) return;
      bwSamplesRef.current.push(sample);
      if (bwSamplesRef.current.length > 12) bwSamplesRef.current.shift();
      const bps = estimate(bwSamplesRef.current);
      if (bps > 0) {
        applyBufferTarget(bps);
        persistLastBps(bps);
      }
      checkHeapAndPruneInternal();
    },
    [applyBufferTarget, persistLastBps, checkHeapAndPruneInternal],
  );

  const maybeMirrorFailoverInner = useCallback(
    async (reason: string, httpCode?: number, loadMs?: number) => {
      // Transcode path: segments are same-origin ffmpeg output, never a CDN mirror.
      // A 403/504 or slow frag here is the local pipeline warming, not a dead edge —
      // rotating the ticket rewrites the session's upstream mid-transcode and restarts
      // playback from 0 (the 6s loop). Only direct (non-transcode) sources may fail over.
      if (transcodeActiveRef.current) return;
      const now = Date.now();
      if (now - lastFailoverAtRef.current < 8000) return;
      if (failoverPendingRef.current) return;
      const isSlow = typeof loadMs === "number" && loadMs > 1500;
      const isBlocked = httpCode === 403 || httpCode === 504;
      if (!isSlow && !isBlocked) return;
      const releases = loadedRef.current?.streams.releases ?? [];
      if (!releases.length) return;
      const curKey = activeRef.current?.releaseKey;
      let curLabel: string | null = null;
      if (curKey) {
        const rel = releases.find((r) => `${r.provider}:${r.filename}` === curKey);
        curLabel = rel?.mirrors[0]?.label ?? null;
      }
      if (curLabel) excludedLabelsRef.current.add(curLabel);
      lastFailoverAtRef.current = now;
      failoverPendingRef.current = true;
      const ticket = (() => {
        try {
          const src = currentSourceRef.current ?? "";
          const m = src.match(/\/api\/proxy\/([0-9a-f]{16,40})\//i);
          return m ? m[1] : null;
        } catch { return null; }
      })();
      if (ticket) {
        try {
          await api.proxyRotate(ticket);
        } catch {}
      }
      // client fallback via exclude param is backend-future; for now rotate + notice
      failoverPendingRef.current = false;
      flashNotice(isSlow ? "Slow connection" : "Source error — retrying");
    },
    [flashNotice],
  );
  const maybeMirrorFailover = maybeMirrorFailoverInner;
  const authedRef = useRef(false);
  // ---- account session -------------------------------------------------
  // Mirrors the (async) session status so callbacks bound to a single render
  // (rAF loop, media events, unmount cleanup) always see the current auth
  // state. Flipping to anon mid-watch simply degrades to local-only writes.
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

  // refs to avoid TDZ with setupMediaSession (defined before seekBy/setRate)
  const setRateRef = useRef<(r: number) => void>(() => undefined);
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
      // OS speed control (lock screen / headset remote). The action name is
      // not in every lib.dom's MediaSessionAction union yet, and browsers
      // throw NotSupportedError for handlers they don't implement — hence
      // the cast and the guard.
      const setHandler = (ms as unknown as {
        setActionHandler: (action: string, handler: ((details: unknown) => void) | null) => void;
      }).setActionHandler.bind(ms);
      try {
        setHandler("playbackrate", (details) => {
          const r = (details as { playbackRate?: number })?.playbackRate;
          if (typeof r === "number" && Number.isFinite(r)) setRateRef.current(r);
        });
      } catch {
        /* browser has no playback-rate control */
      }
    } catch {
      /* unsupported */
    }
  }, [label, provider]);

  // ---------------- source loading ----------------
  const teardown = useCallback(() => {
    if (ratePersistTimerRef.current != null) {
      window.clearTimeout(ratePersistTimerRef.current);
      ratePersistTimerRef.current = null;
    }
    if (bwTickRef.current != null) {
      window.clearInterval(bwTickRef.current);
      bwTickRef.current = null;
    }
    if (jassubActiveRef.current) {
      jassubActiveRef.current = false;
      jassubAssRef.current = null;
      void destroyJassub().catch(() => undefined);
    }
    if (smartHandleRef.current) {
      try { smartHandleRef.current.disable(); } catch {}
    }
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
    transcodeRetryRef.current = 0;
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
  /** Helpers for format/overlay decisions */
  const isAssFormat = (fmt?: string | null) => fmt === 'ass' || fmt === 'ssa';
  const ttmlFormat = (fmt?: string | null) => fmt === 'ttml';
  const needsOverlay = (
    primaryFmt?: string | null,
    secondaryFmt?: string | null,
    dual?: boolean | null,
    filter?: string | null
  ) => {
    if (dual) return true;
    if (filter && filter !== 'all') return true;
    if (isAssFormat(primaryFmt)) return true;
    if (secondaryFmt && isAssFormat(secondaryFmt)) return true;
    return false;
  };
  const parseByFormat = (text: string, fmt?: string | null): import("@/lib/captions").SubtitleCue[] => {
    const lower = (fmt ?? '').toLowerCase();
    if (lower === 'ass' || lower === 'ssa') {
      const a = parseAssCues(text);
      if (a.length) return a;
      return parseSubtitleCues(text);
    }
    if (lower === 'ttml') {
      const tt = parseTtmlCues(text);
      if (tt.length) return tt;
      return parseSubtitleCues(text);
    }
    // auto-sniff: ASS has [Script Info] / Dialogue:
    if (text.includes('[Script Info]') && text.includes('Dialogue:')) {
      const a = parseAssCues(text);
      if (a.length) return a;
    }
    if (text.includes('<tt') && text.includes('<p')) {
      const tt = parseTtmlCues(text);
      if (tt.length) return tt;
    }
    return parseSubtitleCues(text);
  };
  // ---- P3 sub-parse worker (strings only; VTTCues not transferable) ----
  const getSubParseWorker = useCallback((): Worker | null => {
    if (typeof window === "undefined") return null;
    if (subParseWorkerRef.current) return subParseWorkerRef.current;
    try {
      const w = new Worker(new URL("../workers/sub-parse.ts", import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; cues: SubtitleCue[] }>) => {
        const cb = subParsePendingRef.current.get(e.data.id);
        if (cb) {
          subParsePendingRef.current.delete(e.data.id);
          cb(e.data.cues);
        }
      };
      w.onerror = () => {
        for (const [, cb] of subParsePendingRef.current) {
          try { cb([]); } catch {}
        }
        subParsePendingRef.current.clear();
      };
      subParseWorkerRef.current = w;
      return w;
    } catch {
      return null;
    }
  }, []);
  const parseViaWorker = useCallback((text: string, format?: string | null): Promise<SubtitleCue[]> => {
    const lower = (format ?? "").toLowerCase();
    const isHeavy = lower === "ass" || lower === "ssa" || lower === "ttml" || (text.includes("[Script Info]") && text.includes("Dialogue:")) || (text.includes("<tt") && text.includes("<p"));
    if (!isHeavy) return Promise.resolve(parseByFormat(text, format));
    const worker = getSubParseWorker();
    if (!worker) return Promise.resolve(parseByFormat(text, format));
    return new Promise<SubtitleCue[]>((resolve) => {
      const id = (subParseReqIdRef.current = (subParseReqIdRef.current + 1) & 0x7fffffff);
      const timeout = window.setTimeout(() => {
        subParsePendingRef.current.delete(id);
        try { resolve(parseByFormat(text, format)); } catch { resolve([]); }
      }, 4000);
      subParsePendingRef.current.set(id, (cues) => {
        window.clearTimeout(timeout);
        resolve(cues);
      });
      try {
        worker.postMessage({ id, text, format });
      } catch {
        window.clearTimeout(timeout);
        subParsePendingRef.current.delete(id);
        try { resolve(parseByFormat(text, format)); } catch { resolve([]); }
      }
    });
  }, [getSubParseWorker]);
  // ---- P3 hover tooltip (timecode only) + fine-scrub window move ----
  const handleSeekHoverMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) return;
    const wrap = seekWrapRef.current;
    const tip = scrubTooltipRef.current;
    if (!wrap || !tip) return;
    const dur = absoluteDuration();
    if (!isSeekableDuration(dur)) {
      tip.style.display = "none";
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clampedX = Math.max(0, Math.min(rect.width, x));
    if (!thumbLoadedRef.current && transcodeSessionRef.current) void loadThumbsForSession(transcodeSessionRef.current);
    const tt = (clampedX / Math.max(rect.width, 1)) * dur;
    const cues = thumbCuesRef.current;
    const thumb = cues.length ? findThumb(cues, tt) : null;
    const imgBox = scrubTooltipImgRef.current;
    if (thumb && thumbBaseRef.current) {
      const spriteUrl = `${thumbBaseRef.current}${thumb.sprite}`;
      if (imgBox) {
        imgBox.style.display = "block";
        imgBox.style.width = "160px";
        imgBox.style.height = "90px";
        imgBox.style.backgroundImage = `url(${spriteUrl})`;
        imgBox.style.backgroundPosition = `-${thumb.x}px -${thumb.y}px`;
        imgBox.style.backgroundSize = "1600px 900px";
        imgBox.style.backgroundRepeat = "no-repeat";
      }
      // keep time label as second line
      const label = tip.querySelector("[data-thumb-time]") as HTMLElement | null;
      if (label) label.textContent = formatClock(tt);
      else tip.textContent = formatClock(tt);
    } else {
      if (imgBox) imgBox.style.display = "none";
      tip.textContent = formatClock(tt);
    }
    tip.style.display = "block";
    const tipW = tip.offsetWidth || 48;
    const left = Math.max(4, Math.min(rect.width - tipW - 4, clampedX - tipW / 2));
    tip.style.left = `${left}px`;
  }, [absoluteDuration]);
  const handleSeekHoverLeave = useCallback(() => {
    const tip = scrubTooltipRef.current;
    if (tip) tip.style.display = "none";
  }, []);
  const loadThumbsForSession = useCallback(async (session: string) => {
    if (thumbLoadedRef.current || !session) return;
    try {
      const info = await api.transcodeSprites(session);
      const vttUrl = mbUrl(info.vtt_url);
      thumbBaseRef.current = vttUrl.slice(0, vttUrl.lastIndexOf("/")+1);
      const res = await fetch(vttUrl, { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      const cues = parseThumbsVtt(text);
      if (cues.length) { thumbCuesRef.current = cues; thumbLoadedRef.current = true; }
    } catch {}
  }, []);
  // window pointermove during dragging: fine-scrub sensitivity + preview; release via commitSeekFromRange
  useEffect(() => {
    const onWindowMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const wrap = seekWrapRef.current;
      const startX = scrubStartXRef.current;
      const startY = scrubStartYRef.current;
      const grab = scrubGrabTimeRef.current;
      if (!wrap || startX == null || startY == null || grab == null) return;
      const rect = wrap.getBoundingClientRect();
      const dur = transcodeActiveRef.current ? (totalDurationRef.current ?? manifestTotalRef.current ?? 0) : (videoRef.current?.duration ?? 0);
      const durVal = Number.isFinite(dur) && dur > 0 ? dur : 0;
      if (!isSeekableDuration(durVal)) return;
      const w = Math.max(rect.width, 1);
      const pxPerSec = w / durVal;
      const dxPx = e.clientX - startX;
      const dyPx = e.clientY - startY;
      const { previewTime: delta, mode } = applyScrubSensitivity(dxPx, pxPerSec, dyPx);
      const previewAbs = grab + delta;
      const clamped = clampSeekTarget(previewAbs, durVal);
      const v = clamped != null ? clamped : previewAbs;
      const pct = seekProgressPct(v, durVal);
      if (playedFillRef.current) playedFillRef.current.style.width = `${pct}%`;
      if (timeRef.current) timeRef.current.textContent = timeModeRef.current === 'remaining' ? formatRemaining(v, durVal) : formatClock(v);
      if (seekRef.current) {
        seekRef.current.value = String(Math.floor(v));
        seekRef.current.style.setProperty("--progress", `${pct}%`);
      }
      const tip = scrubTooltipRef.current;
      if (tip) {
        tip.textContent = formatClock(v);
        tip.style.display = "block";
        const tipW = tip.offsetWidth || 48;
        const clampedX = Math.max(0, Math.min(w, e.clientX - rect.left));
        const left = Math.max(4, Math.min(w - tipW - 4, clampedX - tipW / 2));
        tip.style.left = `${left}px`;
      }
      if (scrubModeRef.current !== mode) {
        scrubModeRef.current = mode;
        if (mode === 'fine') flashNotice("Fine scrub 0.5×");
        else if (mode === 'ultra') flashNotice("Fine scrub 0.1×");
      }
    };
    window.addEventListener("pointermove", onWindowMove);
    return () => window.removeEventListener("pointermove", onWindowMove);
  }, [flashNotice]);
  useEffect(() => {
    return () => {
      const w = subParseWorkerRef.current;
      if (w) {
        try { w.terminate(); } catch {}
        subParseWorkerRef.current = null;
      }
      subParsePendingRef.current.clear();
    };
  }, []);
  const clampOffset = (ms: number) => Math.max(-2000, Math.min(2000, Math.round(ms)));
  const persistOffset = (field: 'subOffsetMs' | 'subOffsetMs2', ms: number) => {
    try { setPrefs({ [field]: clampOffset(ms) } as Partial<import("@/lib/player-prefs").PlayerPrefs>); } catch {}
  };
  const syncPrimaryToNativeOrOverlay = (cues: import("@/lib/captions").SubtitleCue[], opt: SubtitleOption | null) => {
    const video = videoRef.current;
    if (!video || !opt) return;
    const dualActive = dualSubsRef2.current && !!chosenSub2Ref.current;
    const filterOn = (subFilterRef?.current ?? subFilter) !== 'all';
    const need = needsOverlay(opt.format ?? null, (chosenSub2Ref.current?.format ?? null), dualActive, filterOn ? 'signs' : 'all');
    if (need) {
      // overlay path: clean native, expose via state
      subTrackRef.current?.cleanup();
      subTrackRef.current = null;
      setPrimaryCuesSync(cues);
      overlayNowRef.current = video.currentTime;
      setOverlayNow(video.currentTime);
    } else {
      // native path: attach with offset (attach handles shift), clear overlay cues
      setPrimaryCuesSync([]);
      primaryCuesRef.current = cues;
      subTrackRef.current?.cleanup();
      const state = attachSubtitleTrack(video, opt.name, cues, { offsetMs: subOffsetMsRef.current, source: 'native' });
      subTrackRef.current = state;
      // apply CSS vars subset for native ::cue
      const vars = styleToCssVars(subStyleRef.current);
      try { Object.entries(vars).forEach(([k,v]) => { try{ video.style.setProperty(k, v);}catch{}; try{ document.documentElement.style.setProperty(k, v);}catch{}; }); } catch {}
    }
  };
  const syncSecondaryToOverlay = (cues: import("@/lib/captions").SubtitleCue[], opt: SubtitleOption | null) => {
    if (!opt) { setSecondaryCuesSync([]); dualTrackRef.current?.cleanup(); dualTrackRef.current=null; return; }
    const video = videoRef.current;
    // secondary always overlay when dual active
    setSecondaryCuesSync(cues);
    if (video) { overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime); }
  };
  /** Resolve health capability for this provider (cached). */
  const ensureSubtitleCap = useCallback(async (): Promise<boolean> => {
    if (healthFetchedRef.current && supportsSubsRef.current != null) return supportsSubsRef.current;
    try {
      const h = await api.health();
      const cap = h.providers.find((pp) => pp.key === provider)?.capabilities.supports_subtitles;
      const supports = cap ?? (provider === "moviebox" ? true : false);
      setSupportsSubs(supports);
      healthFetchedRef.current = true;
      return supports;
    } catch {
      const fallback = provider === "moviebox";
      setSupportsSubs(fallback);
      healthFetchedRef.current = true;
      return fallback;
    }
  }, [provider]);

  /** Pick best auto-select candidate from available options per prefs. */
  const pickAutoSubtitle = useCallback((options: SubtitleOption[]): SubtitleOption | null => {
    if (!options.length) return null;
    let prefLangs: string[] = ['en'];
    let preferForced = true;
    let preferSDH = false;
    try {
      const prefs = getPrefs();
      prefLangs = (prefs.prefSubLang ?? ['en']).map((l) => l.toLowerCase());
      preferForced = prefs.prefForced ?? true;
      preferSDH = prefs.preferSDH ?? false;
    } catch {
      // use defaults above
    }
    const langOf = (opt: SubtitleOption) => (opt.language ?? opt.name ?? '').toLowerCase();
    const nameOf = (opt: SubtitleOption) => (opt.name ?? '').toLowerCase();
    for (const want of prefLangs) {
      const candidates = options.filter((o) => {
        const l = langOf(o);
        return l === want || l.startsWith(want + '-') || l.startsWith(want + '_') || nameOf(o).includes(want);
      });
      if (!candidates.length) continue;
      const forcedCandidates = candidates.filter((c) => !!c.forced === preferForced);
      const pool = forcedCandidates.length ? forcedCandidates : candidates;
      const sdhCandidates = pool.filter((c) => !!c.sdh === preferSDH);
      const pool2 = sdhCandidates.length ? sdhCandidates : pool;
      return pool2[0] ?? candidates[0];
    }
    const english = options.find((o) => {
      const l = langOf(o);
      return l === 'en' || l === 'eng' || l === 'english' || nameOf(o).includes('english');
    });
    if (english) return english;
    if (preferForced) {
      const forced = options.find((o) => !!o.forced);
      if (forced) return forced;
    }
    return options[0] ?? null;
  }, []);

  const tryAutoSelect = useCallback((options: SubtitleOption[]) => {
    if (chosenSubRef.current) return;
    if (options.length === 0) return;
    const best = pickAutoSubtitle(options);
    if (!best) return;
    chosenSubRef.current = best;
    setChosenSub(best);
    setTimeout(() => { void applyChosenCaptionsRef.current?.(best); }, 0);
  }, [pickAutoSubtitle]);

  const applyChosenCaptionsRef = useRef<((opt: SubtitleOption | null) => Promise<void>) | null>(null);
  const applySecondRef = useRef<((opt: SubtitleOption | null) => Promise<void>) | null>(null);

  /** Load the available subtitle options once per title, capability-driven. */
  const loadSubtitleOptions = useCallback(async () => {
    const supports = await ensureSubtitleCap();
    if (!supports) {
      setSubOptions([]);
      setSupportsSubs(false);
      return;
    }
    setSupportsSubs(true);
    try {
      const rel = (loadedRef.current?.streams.releases ?? []) as Release[];
      const activeRel = activeRef.current ? rel.find((r) => `${r.provider}:${r.filename}` === activeRef.current?.releaseKey) ?? rel[0] : rel[0];
      const rid = activeRel?.resource_id ?? null;
      const subs = await api.captions(id, rid);
      const tagged: SubtitleOption[] = subs.subtitles.map((o) => ({ ...o, source: 'api' as const }));
      setSubOptions((prev) => {
        const manifestPrev = prev.filter((p) => p.source === 'manifest');
        if (!manifestPrev.length) {
          setTimeout(() => tryAutoSelect(tagged), 0);
          return tagged;
        }
        const merged: SubtitleOption[] = [...tagged];
        const keyFor = (o: SubtitleOption) => `${o.url}::${(o.language ?? o.name ?? '').toLowerCase()}::${o.format ?? ''}::${o.forced?1:0}::${o.sdh?1:0}`;
        const seen = new Set(tagged.map((tt) => keyFor(tt)));
        for (const mm of manifestPrev) {
          const key = keyFor(mm);
          if (!seen.has(key)) {
            merged.push(mm);
            seen.add(key);
          }
        }
        setTimeout(() => tryAutoSelect(merged), 0);
        return merged;
      });
    } catch {
      setSubOptions((prev) => {
        const manifestOnly = prev.filter((p) => p.source === 'manifest');
        return manifestOnly;
      });
    }
  }, [provider, id, ensureSubtitleCap, tryAutoSelect]);

  /** Merge manifest-discovered tracks into subOptions, deduped by (url, language). */
  const mergeManifestTracks = useCallback((tracks: { language: string; url: string; kind: string; forced?: boolean; sdh?: boolean }[], baseDir: string | null) => {
    if (!tracks.length) return;
    const opts: SubtitleOption[] = tracks.map((tt) => {
      let url = tt.url;
      if (baseDir && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/') && !url.startsWith('/api/')) {
        url = baseDir + url;
      }
      const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
      const fmt = (['srt','vtt','ass','ssa','ttml'].includes(ext) ? ext : undefined) as SubtitleOption['format'];
      const isForced = tt.forced;
      const isSdh = tt.sdh;
      const name = tt.language ? `${tt.language}${isForced ? ' (forced)' : ''}${isSdh ? ' SDH' : ''}` : url;
      return {
        name,
        url,
        language: tt.language,
        format: fmt,
        forced: isForced,
        sdh: isSdh,
        source: 'manifest' as const,
      };
    });
    setSubOptions((prev) => {
      const k2 = (o: SubtitleOption) => `${o.url}::${(o.language ?? o.name ?? '').toLowerCase()}::${o.format ?? ''}::${o.forced?1:0}::${o.sdh?1:0}`;
      const existingKeys = new Set(prev.map((p) => k2(p)));
      const toAdd: SubtitleOption[] = [];
      for (const o of opts) {
        const k = k2(o);
        if (!existingKeys.has(k)) {
          existingKeys.add(k);
          toAdd.push(o);
        }
      }
      if (!toAdd.length) return prev;
      const merged = [...prev, ...toAdd];
      setTimeout(() => tryAutoSelect(merged), 0);
      return merged;
    });
  }, [tryAutoSelect]);

  /** Fetch + parse one subtitle file through the header-injecting proxy. */
  const fetchSubtitleText = useCallback(async (opt: SubtitleOption): Promise<string | null> => {
    if (opt.url.startsWith('/api/proxy/')) {
      try {
        const r = await fetch(opt.url, { cache: "no-store" });
        if (!r.ok) return null;
        return await r.text();
      } catch { return null; }
    }
    if (opt.url.startsWith('blob:')) {
      const local = localCuesRef.current;
      if (local && local.url === opt.url) {
        return null;
      }
      try {
        const r = await fetch(opt.url);
        if (!r.ok) return null;
        return await r.text();
      } catch { return null; }
    }
    let hdrs: [string, string][] = [];
    try {
      const rels = (loadedRef.current?.streams.releases ?? []) as Release[];
      const curKey = activeRef.current?.releaseKey;
      let rel: Release | undefined;
      if (curKey) rel = rels.find((r) => `${r.provider}:${r.filename}` === curKey);
      if (!rel) rel = rels[0];
      if (rel?.mirrors?.[0]?.headers) hdrs = rel.mirrors[0].headers as [string, string][];
    } catch {}
    let res: Response;
    try {
      res = await fetch(`/api/mb/proxy/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: opt.url, headers: hdrs }),
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
    const ticketVal = (body as { ticket?: unknown }).ticket;
    if (typeof ticketVal !== "string" || !ticketVal) return null;
    try {
      const subRes = await fetch(`/api/proxy/${ticketVal}/`, { cache: "no-store", priority: "low" } as unknown as RequestInit);
      if (!subRes.ok) return null;
      return await subRes.text();
    } catch {
      return null;
    }
  }, []);

  /** Handle hidden file input side-load (ASS/TTML via worker strings). */
  const handleSideLoadFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const rawFmt = file.name.split('.').pop()?.toLowerCase() ?? '';
      const cues = await parseViaWorker(text, rawFmt);
      if (!cues.length) {
        flashNotice("No cues found in file");
        return;
      }
      const ext = rawFmt;
      const fmt = (['srt','vtt','ass','ssa','ttml'].includes(ext) ? ext : undefined) as SubtitleOption['format'];
      const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const opt: SubtitleOption = {
        name: file.name,
        url: blobUrl,
        language: 'local',
        format: fmt,
        source: 'local',
      };
      localCuesRef.current = opt;
      const video = videoRef.current;
      if (!video) return;
      flashNotice(`Loaded ${file.name}`);
      const need = needsOverlay(fmt ?? null, (chosenSub2Ref.current?.format ?? null), dualSubsRef2.current, (subFilterRef.current ?? 'all') !== 'all' ? 'signs' : 'all');
      if (need) {
        subTrackRef.current?.cleanup(); subTrackRef.current=null;
        setPrimaryCuesSync(cues);
        primaryCuesRef.current=cues;
      } else {
        subTrackRef.current?.cleanup();
        const state = attachSubtitleTrack(video, opt.name, cues, { offsetMs: subOffsetMsRef.current, source: 'native' });
        subTrackRef.current = state;
        setPrimaryCuesSync([]);
        primaryCuesRef.current = cues;
        const vars = styleToCssVars(subStyleRef.current);
        try { Object.entries(vars).forEach(([k,v])=> { try{ video.style.setProperty(k,v);}catch{}; try{ document.documentElement.style.setProperty(k,v);}catch{}; }); } catch{}
      }
      setSubOptions((prev) => {
        if (prev.some((p) => p.url === blobUrl)) return prev;
        return [...prev, opt];
      });
      chosenSubRef.current = opt;
      setChosenSub(opt);
    } catch {
      flashNotice("Failed to load subtitle file");
    }
  }, [flashNotice]);

  /** Cheap re-apply after source (re)starts — only when captions are on. */
  const reapplyCaptions = useCallback(() => {
    const video = videoRef.current;
    const cur = chosenSubRef.current;
    if (!video || !cur) return;
    const cur2 = chosenSub2Ref.current;
    const dualActive = dualSubsRef2.current && !!cur2;
    const needPrimary = needsOverlay(cur.format ?? null, cur2?.format ?? null, dualActive, (subFilterRef.current ?? 'all') !== 'all' ? 'signs' : 'all');
    if (cur.source === 'local' && subTrackRef.current) {
      if (needPrimary) {
        // local via overlay: cues already in state, just keep them
      } else {
        reattachSubtitleTrack(video, subTrackRef.current);
        ensureActiveCues(video, subTrackRef.current);
      }
    } else if (needPrimary) {
      // overlay already has cues — ensure clock will paint; native cleaned
      if (subTrackRef.current) { subTrackRef.current.cleanup(); subTrackRef.current=null; }
    } else {
      reattachSubtitleTrack(video, subTrackRef.current);
      ensureActiveCues(video, subTrackRef.current);
      // reapply native vars
            const vars = styleToCssVars(subStyleRef.current);
            try { Object.entries(vars).forEach(([k,v])=> { try{ video.style.setProperty(k,v);}catch{}; try{ document.documentElement.style.setProperty(k,v);}catch{}; }); } catch {}
    }
    if (dualActive && cur2) {
      // secondary always overlay when dual — nothing native to reattach unless we had native secondary (we don't)
      // just ensure overlay clock tick
      if (video) { overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime); }
    }
  }, []);

  /** (Re)attach a chosen option, or clear the track when opt is null ("Off"). */
  const applyChosenCaptions = useCallback(
    async (opt: SubtitleOption | null) => {
      const video = videoRef.current;
      if (!opt || !video) {
        if (jassubActiveRef.current) {
          jassubActiveRef.current = false;
          jassubAssRef.current = null;
          void destroyJassub().catch(() => undefined);
        }
        subTrackRef.current?.cleanup(); subTrackRef.current=null;
        setPrimaryCuesSync([]);
        primaryCuesRef.current=[];
        return;
      }
      // Tear down any previous JASSUB before switching track
      if (jassubActiveRef.current) {
        jassubActiveRef.current = false;
        jassubAssRef.current = null;
        void destroyJassub().catch(() => undefined);
        setPrimaryCuesSync([]);
        primaryCuesRef.current=[];
      }
      if (opt.source === 'local' && localCuesRef.current?.url === opt.url) {
        try {
          const r = await fetch(opt.url);
          if (!r.ok) return;
          const txt = await r.text();
          const cues = await parseViaWorker(txt, opt.format ?? null);
          if (!cues.length) return;
          if (chosenSubRef.current !== opt) return;
          const dualActive = dualSubsRef2.current && !!chosenSub2Ref.current;
          const need = needsOverlay(opt.format ?? null, chosenSub2Ref.current?.format ?? null, dualActive, (subFilterRef.current ?? 'all') !== 'all' ? 'signs' : 'all');
          if (need) {
            subTrackRef.current?.cleanup(); subTrackRef.current=null;
            setPrimaryCuesSync(cues); primaryCuesRef.current=cues;
            overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime);
          } else {
                  subTrackRef.current?.cleanup();
            const state = attachSubtitleTrack(video, opt.name, cues, { offsetMs: subOffsetMsRef.current, source:'native'});
            subTrackRef.current=state;
            setPrimaryCuesSync([]); primaryCuesRef.current=cues;
            const vars = styleToCssVars(subStyleRef.current);
            try { Object.entries(vars).forEach(([k,v])=> { try{ video.style.setProperty(k,v);}catch{}; try{ document.documentElement.style.setProperty(k,v);}catch{}; }); } catch {}
          }
        } catch {}
        return;
      }
      const text = await fetchSubtitleText(opt);
      if (text == null) return;
      if (chosenSubRef.current !== opt) return;
      const fmtLower = (opt.format ?? "").toLowerCase();
      const dualActive = dualSubsRef2.current && !!chosenSub2Ref.current;
      const filterOn = (subFilterRef.current ?? 'all') !== 'all';
      const isAss = fmtLower === 'ass' || fmtLower === 'ssa' || (text.includes('[Script Info]') && text.includes('Dialogue:'));
      // ASS via JASSUB worker only when single track, no filter, no dual — lazy import
      if (isAss && !filterOn && !dualActive) {
        // lazy: dynamic import so bundle doesn't pay WASM cost until ASS chosen
        try {
          // keep parsed cues as fallback until worker ready; clear native
          subTrackRef.current?.cleanup(); subTrackRef.current=null;
          setPrimaryCuesSync([]);
          primaryCuesRef.current=[];
          // jassub worker — only for ASS (libass WASM handles typesetting, fonts)
          const ok = await attachJassub(video, text);
          if (ok) {
            if (chosenSubRef.current !== opt) {
              void destroyJassub().catch(() => undefined);
              return;
            }
            jassubActiveRef.current = true;
            jassubAssRef.current = text;
            // also parse stripped cues for lookup/filter fallback if JASSUB destroyed
            const cues = await parseViaWorker(text, opt.format ?? null);
            if (cues.length) { setPrimaryCuesSync([]); primaryCuesRef.current = cues; }
            return;
          }
        } catch {}
        // JASSUB failed — fall through to stripped overlay
      }
      const cues = await parseViaWorker(text, opt.format ?? null);
      if (!cues.length) { flashNotice("No cues in subtitle"); return; }
      if (chosenSubRef.current !== opt) return;
      const need = needsOverlay(opt.format ?? null, chosenSub2Ref.current?.format ?? null, dualActive, (subFilterRef.current ?? 'all') !== 'all' ? 'signs' : 'all');
      if (need) {
        subTrackRef.current?.cleanup(); subTrackRef.current=null;
        setPrimaryCuesSync(cues); primaryCuesRef.current=cues;
        if (video) { overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime); }
      } else {
        subTrackRef.current?.cleanup();
        const state = attachSubtitleTrack(video, opt.name, cues, { offsetMs: subOffsetMsRef.current, source:'native'});
        subTrackRef.current=state;
        setPrimaryCuesSync([]); primaryCuesRef.current=cues;
        const vars = styleToCssVars(subStyleRef.current);
        try { const el = containerRef.current ?? video; Object.entries(vars).forEach(([k,v])=> el.style.setProperty(k,v)); } catch{}
      }
    },
    [fetchSubtitleText],
  );

  const applySecondCaptions = useCallback(async (opt: SubtitleOption | null) => {
    const video = videoRef.current;
    if (!opt || !video) {
      setSecondaryCuesSync([]); secondaryCuesRef.current=[]; dualTrackRef.current?.cleanup(); dualTrackRef.current=null; return;
    }
    if (opt.source === 'local' && localCuesRef.current?.url === opt.url) {
      try {
        const r = await fetch(opt.url); if(!r.ok) return; const txt=await r.text();
        const cues = await parseViaWorker(txt, opt.format ?? null);
        if(chosenSub2Ref.current!==opt) return;
        setSecondaryCuesSync(cues); secondaryCuesRef.current=cues; overlayNowRef.current=video.currentTime; setOverlayNow(video.currentTime);
      } catch{}
      return;
    }
    const text = await fetchSubtitleText(opt);
    if(text==null) return;
    const cues = await parseViaWorker(text, opt.format ?? null);
    if(!cues.length){ flashNotice("No cues in subtitle"); return; }
    if(chosenSub2Ref.current!==opt) return;
    setSecondaryCuesSync(cues); secondaryCuesRef.current=cues;
    if(video){ overlayNowRef.current=video.currentTime; setOverlayNow(video.currentTime); }
  }, [fetchSubtitleText]);
  useEffect(() => { applySecondRef.current = applySecondCaptions; }, [applySecondCaptions]);

  /** User picked an option (or Off) in the CC panel. */
  const chooseSubtitle = useCallback(
    (opt: SubtitleOption | null) => {
      if (opt) lastChosenSubRef.current = opt;
      if (!opt) {
        if (jassubActiveRef.current) {
          jassubActiveRef.current = false; jassubAssRef.current = null;
          void destroyJassub().catch(() => undefined);
        }
        subTrackRef.current?.cleanup(); subTrackRef.current = null;
        setPrimaryCuesSync([]); primaryCuesRef.current=[];
        setLookup(null);
        // if dual was active, demote? keep secondary but it will become hidden until new primary chosen — keep for now
      } else {
        if (jassubActiveRef.current) {
          jassubActiveRef.current = false; jassubAssRef.current = null;
          void destroyJassub().catch(() => undefined);
        }
        setLookup(null);
      }
      chosenSubRef.current = opt;
      setChosenSub(opt);
      setSubsOpen(false);
      // When dual is on, we must re-evaluate both tracks for overlay needs
      if (!opt) {
        // off primary — keep secondary paused visually? clear secondary overlay too per spec: dual only when both chosen
        // leave secondary cues but overlay condition will hide them (needs both)
      } else {
        // trigger sync for second track if dual active (it was overlay; ensure it stays)
        if (dualSubsRef2.current && chosenSub2Ref.current) {
          // force secondary back through overlay path (it already is)
        }
      }
      void applyChosenCaptions(opt);
      // If we toggled between native/overlay, re-sync secondary rendering mode
      if (dualSubsRef2.current && chosenSub2Ref.current) {
        // re-apply second through overlay to keep both via same renderer
        void applySecondRef.current?.(chosenSub2Ref.current);
      }
    },
    [applyChosenCaptions],
  );
  const chooseSecondSubtitle = useCallback((opt: SubtitleOption | null) => {
    if (opt && opt.url === chosenSubRef.current?.url) {
      flashNotice("Secondary must differ from primary");
      return;
    }
    chosenSub2Ref.current = opt;
    dualSubRef.current = opt;
    setChosenSub2(opt);
    // dual toggle persists via pref when user explicitly picks second; keep dual enabled
    if (opt) {
      if (!dualSubsRef2.current) {
        dualSubsRef2.current = true; setDualSubsState(true); try{ setPrefs({ dualSubs:true}); }catch{}
      }
      // migrate primary to overlay if it was native
      const primaryOpt = chosenSubRef.current;
      if (primaryOpt && primaryCuesRef.current.length && subTrackRef.current && subTrackRef.current.track) {
        // primary was native -> convert to overlay
        const cues = [...primaryCuesRef.current];
        subTrackRef.current.cleanup(); subTrackRef.current=null;
        setPrimaryCuesSync(cues);
        const video = videoRef.current; if(video){ overlayNowRef.current=video.currentTime; setOverlayNow(video.currentTime); }
      } else if (primaryOpt && primaryCuesRef.current.length===0 && subTrackRef.current) {
        // primary was native but cues held in trackState.cues
        const cues = [...(subTrackRef.current.cues ?? [])];
        subTrackRef.current.cleanup(); subTrackRef.current=null;
        setPrimaryCuesSync(cues); primaryCuesRef.current=cues;
        const video=videoRef.current; if(video){ overlayNowRef.current=video.currentTime; setOverlayNow(video.currentTime);}
      } else if (primaryOpt && !primaryCuesRef.current.length && primaryCues.length===0 && (subTrackRef.current==null)) {
        // no primary cues stored yet (maybe still loading) — let applyChosenCaptions handle next time
      }
    }
    void applySecondCaptions(opt);
    // when turning second off, if we drop to single and format allows native, convert back
    if (!opt) {
      const primaryOpt = chosenSubRef.current;
      if (primaryOpt && primaryCuesRef.current.length) {
        // if primary not ASS and filter all, move back to native for a11y
        const need = needsOverlay(primaryOpt.format ?? null, null, false, (subFilterRef.current ?? 'all') !== 'all' ? 'signs' : 'all');
        if (!need) {
          const video=videoRef.current; if(video){
            const cues=[...primaryCuesRef.current];
            setPrimaryCuesSync([]); primaryCuesRef.current=cues;
            const state = attachSubtitleTrack(video, primaryOpt.name, cues,{offsetMs: subOffsetMsRef.current, source:'native'});
            subTrackRef.current=state;
            const vars=styleToCssVars(subStyleRef.current);
            try{ Object.entries(vars).forEach(([k,v])=> { try{ video.style.setProperty(k,v);}catch{}; try{ document.documentElement.style.setProperty(k,v);}catch{}; }); }catch{}
          }
        }
      }
    }
  }, [applySecondCaptions, flashNotice]);
  const toggleDual = useCallback((next: boolean) => {
    dualSubsRef2.current = next;
    setDualSubsState(next);
    try{ setPrefs({ dualSubs: next }); }catch{}
    const video=videoRef.current;
    const primaryOpt=chosenSubRef.current;
    const secOpt=chosenSub2Ref.current;
    if (next) {
      // enabling dual: ensure primary now via overlay, and if no secondary yet pick nothing (user must pick)
      if (primaryOpt) {
        let cues: import("@/lib/captions").SubtitleCue[] = [];
        if (primaryCuesRef.current.length) cues=[...primaryCuesRef.current];
        else if (subTrackRef.current?.cues) cues=[...subTrackRef.current.cues];
        else if (primaryCues.length) cues=[...primaryCues];
        if (cues.length) {
          subTrackRef.current?.cleanup(); subTrackRef.current=null;
          setPrimaryCuesSync(cues); primaryCuesRef.current=cues;
          if(video){ overlayNowRef.current=video.currentTime; setOverlayNow(video.currentTime); }
        }
      }
      // if we have a secondary but it was cleared earlier, re-apply it
      if (secOpt) void applySecondRef.current?.(secOpt);
    } else {
      // disabling dual: secondary hidden, primary may go back to native
      setSecondaryCuesSync([]); // keeps secondary choice for re-enable but hides overlay
      // keep chosenSub2 value but don't show; spec: dualOff hides second slot, choice persists
      if (primaryOpt) {
        const cues = primaryCuesRef.current.length ? [...primaryCuesRef.current] : (primaryCues.length ? [...primaryCues] : []);
        const need = needsOverlay(primaryOpt.format ?? null, null, false, (subFilterRef.current ?? 'all') !== 'all' ? 'signs' : 'all');
        if (!need && cues.length && video) {
          setPrimaryCuesSync([]); primaryCuesRef.current=cues;
          const state = attachSubtitleTrack(video, primaryOpt.name, cues,{offsetMs: subOffsetMsRef.current, source:'native'});
          subTrackRef.current=state;
          const vars=styleToCssVars(subStyleRef.current);
          try{ Object.entries(vars).forEach(([k,v])=> { try{ video.style.setProperty(k,v);}catch{}; try{ document.documentElement.style.setProperty(k,v);}catch{}; }); }catch{}
        }
      }
    }
    pokeControls();
  }, [primaryCues]);

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
        try {
          const state = await api.transcodeState(session);
          applyTranscodeState(state);
          if (!state.restarting && state.ready && state.segments >= 1) return;
        } catch {
          // Backend recycle / session restart mid-poll surfaces as 404/502: keep waiting
          // for the deadline instead of failing the whole title on a transient miss.
        }
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
        restorePlaybackRate();
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
        let seedBps = 2_000_000;
        let bb: BackBuffer = 30;
        try {
          const p = getPrefs();
          if (Number.isFinite(p.lastBps) && p.lastBps > 0) seedBps = p.lastBps;
          bb = p.backBuffer as BackBuffer;
        } catch {}
        const initTarget = bufferTargetFor(seedBps);
        const backLen = bb === 0 ? Infinity : bb;
        const hls = new Hls({
          maxBufferLength: initTarget,
          backBufferLength: backLen,
          abrEwmaDefaultEstimate: seedBps,
          startLevel: 0,
          capLevelToPlayerSize: true,
          startFragPrefetch: true,
        });
        hlsRef.current = hls;
        // seed estimator state
        lastBwEstimateRef.current = seedBps;
        lastAppliedTargetRef.current = initTarget;
        lastTargetChangeAtRef.current = Date.now();
        bwSamplesRef.current = [];
        // HLS 1s tick (hysteresis inside applyBufferTarget)
        try {
          if (bwTickRef.current != null) window.clearInterval(bwTickRef.current);
          bwTickRef.current = window.setInterval(() => {
            if (lastBwEstimateRef.current > 0) applyBufferTarget(lastBwEstimateRef.current);
            checkHeapAndPruneInternal();
          }, 1000);
        } catch {}
        hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal: boolean; type: string; details?: string; networkDetails?: { status?: number } | null; response?: { code?: number } }) => {
          const netStatus =
            data.networkDetails != null && typeof data.networkDetails.status === "number"
              ? data.networkDetails.status
              : undefined;
          const respCode =
            data.response != null && typeof data.response.code === "number" ? data.response.code : undefined;
          const code = netStatus ?? respCode;
          if (code === 403 || code === 504) void maybeMirrorFailover("frag error", code);
          if (!data.fatal) {
            // hls.js fires non-fatal BUFFER_STALLED_ERROR while it fills the
            // buffer after a seek jump; the engine recovers on its own.
            // Surfacing a spinner here fights the pending-seek pin and reads
            // as a rubberband. Only fatal errors tear down.
            return;
          }
          // A superseded engine's fatal error must not tear down the live one.
          if (hlsRef.current !== hls || sourceEpochRef.current !== epoch) return;
          // Transient: the transcode playlist may not exist yet when the engine attaches
          // (ffmpeg still warming). Retry the load instead of tearing down on the first fatal
          // network error — hls.js recovers once index.m3u8 appears.
          if (data.type === "networkError") {
            const d = typeof data.details === "string" ? data.details : "";
            const fatalNet =
              d === "manifestLoadError" || d === "manifestLoadTimeOut" || d === "levelLoadError" || d === "levelLoadTimeOut";
            if (fatalNet && transcodeActiveRef.current) {
              const idx = transcodeIndexUrlRef.current;
              if (idx && transcodeRetryRef.current < 8) {
                transcodeRetryRef.current += 1;
                window.setTimeout(() => {
                  if (hlsRef.current === hls && sourceEpochRef.current === epoch) {
                    try {
                      hls.loadSource(idx);
                    } catch {}
                  }
                }, 1500);
                return;
              }
            }
          }
          teardown();
        });
        hls.on(Hls.Events.FRAG_LOADED, (_event: string, data: unknown) => {
          try {
            const d = data as { frag?: { stats?: { loaded?: number; loading?: { start?: number; end?: number } }; type?: string } };
            const stats = d?.frag?.stats;
            const loaded = typeof stats?.loaded === "number" ? stats.loaded : 0;
            const s = stats?.loading?.start;
            const e = stats?.loading?.end;
            if (Number.isFinite(loaded) && loaded > 0 && Number.isFinite(s) && Number.isFinite(e) && (e as number) > (s as number)) {
              const ms = (e as number) - (s as number);
              if (ms > 0 && ms < 120_000) {
                pushBwSample({ bytes: loaded, ms });
                if (ms > 1500) void maybeMirrorFailover("slow frag", undefined, ms);
              }
            }
          } catch {}
        });
        // fetch priority not applicable via xhrSetup for segments (engine XHR); manifests high priority via our own fetches
        hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
        hls.on(Hls.Events.LEVEL_UPDATED, () => {
          ensureActiveCues(video, subTrackRef.current);
          // re-apply buffer target on ABR level change (hysteresis inside)
          if (lastBwEstimateRef.current > 0) applyBufferTarget(lastBwEstimateRef.current);
        });
        hls.loadSource(indexUrl);
        hls.attachMedia(video);
        // NOTE: no native fallback here. Setting video.src on an MSE-managed element detaches the
        // MediaSource the engine just attached — the element then fetches the playlist as a native
        // resource, fails ("Content-Type not supported"), and fires the decoder error in the report.
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
        void loadThumbsForSession(started.session);
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

      const looksMp4 =
        /\.mp4($|\?)/i.test(source) ||
        rel.mirrors.some((m) => /\.mp4($|\?)/i.test(m.resolver_url)) ||
        /\.mp4($|\?)/i.test(rel.filename ?? "");
      // The provider tags container but ships H.265 inside: codec is the only
      // signal on an .mp4 URL, and native playback would be black+audio on an
      // HEVC-less browser. Route those to the live transcoder up front.
      const codecHintHevc = /hevc|h265|x265|dvh/i.test(rel.codec ?? "");
      const needTranscodeProbe =
        looksMp4 && codecHintHevc && typeof window !== "undefined" && window.MediaSource != null && !browserSupportsHevc(video);
      const isDash =
        (!looksMp4 || needTranscodeProbe) &&
        (needTranscodeProbe ||
          source.endsWith(".mpd") ||
          rel.quality?.toLowerCase().includes("multi") ||
          rel.mirrors.some((m) => m.resolver_url.includes(".mpd")));

      if (isDash) {
        // An .mp4 URL carrying an HEVC codec hint never reaches the DASH path:
        // the container label is untrusted, the codec tag is the signal, and
        // native playback would be black+audio on this browser.
        if (needTranscodeProbe) {
          console.warn("[playback] mp4 with HEVC codec hint; routing to transcode");
          hevcOnlyRef.current = true;
          await startTranscode(source);
          return;
        }
        // Sniff the manifest before dash.js: HEVC-family streams are undecodable
        // in Chromium/Linux → fall back to live transcode; mixed streams have
        // their HEVC representations stripped client-side.
        let manifestText: string | null = null;
        try {
          const res = await fetch(source, { cache: "no-store", priority: "high" } as unknown as RequestInit);
          if (res.ok) manifestText = await res.text();
        } catch {
          console.warn("[playback] manifest sniff fetch failed; playing original URL with watchdog cover");
        }
        let dashSource = source;
        if (manifestText !== null) {
          const pre = sniffManifest(manifestText);
          console.warn(`[playback] sniff codecs=[${pre.videoCodecs.join(",")}] hevcOnly=${pre.hevcOnly} fallback=${pre.hasFallback} bytes=${manifestText.length}`);
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
          // Manifest subtitle extraction for DASH (soft subs): merge into subOptions.
          if (manifestText !== null) {
            const subs = sniffSubtitles(manifestText, false);
            if (subs.length) {
              const baseDir = source.slice(0, source.lastIndexOf("/") + 1);
              mergeManifestTracks(subs, baseDir);
            }
          }
        }
        // DASH engine lives below; manifest block ends here.

        // Exception: static import crashes SSR; load only when needed in browser
        const dashModuleEpoch = sourceEpochRef.current;
        const dashjs = (await import("dashjs")).default;
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
        let dashSeedBps = 2_000_000;
        let dashBB: BackBuffer = 30;
        try {
          const p = getPrefs();
          if (Number.isFinite(p.lastBps) && p.lastBps > 0) dashSeedBps = p.lastBps;
          dashBB = p.backBuffer as BackBuffer;
        } catch {}
        const dashInitTarget = bufferTargetFor(dashSeedBps);
        lastBwEstimateRef.current = dashSeedBps;
        lastAppliedTargetRef.current = dashInitTarget;
        lastTargetChangeAtRef.current = Date.now();
        bwSamplesRef.current = [];
        const dashKeep = dashBB === 0 ? 30 : dashBB;
        try {
          dash.updateSettings({
            debug: { logLevel: 1 },
            streaming: {
              buffer: { stableBufferTime: dashInitTarget / 2, bufferToKeep: dashKeep },
              abr: { initialBitrate: { video: 400 } as unknown as Record<string, number>, autoSwitchBitrate: { video: true } as unknown as Record<string, boolean> },
            },
          } as unknown as Parameters<typeof dash.updateSettings>[0]);
        } catch {
          try { dash.updateSettings({ debug: { logLevel: 1 } }); } catch {}
        }
        try {
          dash.on(dashjs.MediaPlayer.events.FRAGMENT_LOADING_COMPLETED, (e: unknown) => {
            try {
              const ev = e as { request?: { bytesLoaded?: number; bytesTotal?: number; requestStartDate?: Date; requestEndDate?: Date | null; mediaType?: string }; response?: ArrayBuffer };
              if (ev?.request?.mediaType && ev.request.mediaType !== "video" && ev.request.mediaType !== "audio") return;
              const bytes = typeof ev?.request?.bytesLoaded === "number" && ev.request.bytesLoaded > 0 ? ev.request.bytesLoaded : (ev?.response ? (ev.response as ArrayBuffer).byteLength : 0);
              const s = ev?.request?.requestStartDate ? new Date(ev.request.requestStartDate).getTime() : NaN;
              const en = ev?.request?.requestEndDate ? new Date(ev.request.requestEndDate as unknown as Date).getTime() : NaN;
              const ms = Number.isFinite(s) && Number.isFinite(en) ? en - s : NaN;
              if (bytes > 0 && Number.isFinite(ms) && ms > 0 && ms < 120_000) {
                pushBwSample({ bytes, ms });
                if (ms > 1500) void maybeMirrorFailover("slow frag", undefined, ms);
              }
            } catch {}
          });
        } catch {}
        // 1s hysteresis tick for DASH (LEVEL_UPDATED is HLS-only)
        try {
          if (bwTickRef.current != null) window.clearInterval(bwTickRef.current);
          bwTickRef.current = window.setInterval(() => {
            if (lastBwEstimateRef.current > 0) applyBufferTarget(lastBwEstimateRef.current);
            checkHeapAndPruneInternal();
          }, 1000);
        } catch {}
        const fatal = (code: number | undefined) =>
          code != null && (code === 27 || code === 34 || code === 2 || code === 11);
        dash.on(dashjs.MediaPlayer.events.ERROR, (data: unknown) => {
          if (dashRef.current !== dash) return; // superseded engine — ignore
          try {
            const err = (data as { error?: { code?: number; message?: string } })?.error;
            if (err?.code === 403 || err?.code === 504) void maybeMirrorFailover("dash error", err.code);
          } catch {}
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
          restorePlaybackRate();
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
            const res = await fetch(source, { cache: "no-store", priority: "high" } as unknown as RequestInit);
            if (res.ok) hlsText = await res.text();
          } catch {
            /* playlist unreadable — play with watchdog cover */
          }
          // A source switch/teardown while the sniff was in flight → abandon.
          if (sourceEpochRef.current !== hlsSniffEpoch) return;
          if (hlsText !== null) {
            const sniff = sniffHls(hlsText);
            hevcOnlyRef.current = sniff.videoCodecs.length ? sniff.hevcOnly : null;
            // Extract subtitles from HLS manifest (EXT-X-MEDIA TYPE=SUBTITLES) before potential transcode.
            const hlsSubs = sniffSubtitles(hlsText, true);
            if (hlsSubs.length) {
              const baseDir = source.slice(0, source.lastIndexOf("/") + 1);
              mergeManifestTracks(hlsSubs, baseDir);
            }
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
          restorePlaybackRate();
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
          animeIds: /^\d+$/.test(id) ? { anilistId: Number(id), malId: null } : null,
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

  // ---------------- skip markers (B2) ----------------
  const skipFetchedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const det = loaded.details as unknown as { animeIds?: { anilistId?: number | null; malId?: number | null } | null };
    const anilistId = det.animeIds?.anilistId ?? null;
    const malId = det.animeIds?.malId ?? null;
    const key = `${provider}:${id}:${season}:${episode}:${anilistId ?? "-"}:${malId ?? "-"}`;
    if (skipFetchedKeyRef.current === key) return;
    skipFetchedKeyRef.current = key;
    let cancelled = false;
    void api
      .skipMarkers({ provider, id, season, episode, anilistId: anilistId as number | null, malId: malId as number | null })
      .then((res) => {
        if (cancelled) return;
        const markers = (res as unknown as { markers?: { start: number; end: number; kind: string; label: string }[] }).markers;
        if (!markers || markers.length === 0) return;
        const mapped: (import("@/lib/types").Chapter)[] = markers
          .map((m) => {
            const k = (m.kind || "").toLowerCase();
            let kind: import("@/lib/types").Chapter["kind"];
            if (k === "op" || k === "intro") kind = "intro";
            else if (k === "ed" || k === "outro") kind = "outro";
            else if (k === "preview") kind = "preview";
            else if (k === "credits") kind = "credits";
            else kind = "intro";
            return {
              start: Number(m.start),
              end: Number(m.end),
              kind,
              label: String(m.label || (kind === "intro" ? "Opening" : kind === "outro" ? "Ending" : kind)),
            };
          })
          .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.start >= 0);
        if (!mapped.length) return;
        setLoaded((prev) => {
          if (!prev) return prev;
          const existing = (prev.streams as unknown as { chapters?: import("@/lib/types").Chapter[] }).chapters ?? [];
          const seen = new Set(existing.map((c) => `${c.start}:${c.end}:${c.kind}`));
          const toAdd = mapped.filter((c) => !seen.has(`${c.start}:${c.end}:${c.kind}`));
          if (!toAdd.length) return prev;
          const merged = [...existing, ...toAdd].sort((a, b) => a.start - b.start);
          return { ...prev, streams: { ...prev.streams, chapters: merged } as typeof prev.streams };
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loaded, provider, id, season, episode]);

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
      !isComplete(entry.position, entry.duration)
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

  // Quick CC toggle (one-tap ON/OFF) — keeps last choice for restore (defined after pokeControls to avoid TDZ)
  const toggleCcQuick = useCallback(() => {
    if (chosenSub) {
      lastChosenSubRef.current = chosenSub;
      chooseSubtitle(null);
    } else {
      const fallback = lastChosenSubRef.current ?? (subOptions[0] ?? null);
      if (fallback) chooseSubtitle(fallback);
      else flashNotice("No subtitles available");
    }
    pokeControls();
  }, [chosenSub, subOptions, chooseSubtitle, flashNotice, pokeControls]);

  // ---------------- prefs hydration ----------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefs = getPrefs();
    setMuted(prefs.muted);
    setVolume(prefs.volume);
    volumeRef.current = prefs.volume;
    setVolumeBoost(prefs.volumeBoost);
    volumeBoostRef.current = prefs.volumeBoost;
    setNormalizeOn(prefs.normalize);
    normalizeGainRef.current = prefs.normalize;
    setAspectModeState(prefs.aspectMode);
    setFilterMode(prefs.filter);
    setNightDimState(prefs.nightDim);
    setBrightnessState(prefs.brightness);
    brightnessRef.current = prefs.brightness;
    setStatsOpen(prefs.statsOpen);
    // P2 sub prefs hydration
    setDualSubsState(prefs.dualSubs);
    dualSubRef.current = prefs.dualSubs ? dualSubRef.current : null; // keep ref consistent on hydration
    chosenSub2Ref.current = prefs.dualSubs ? chosenSub2Ref.current : null;
    setSubOffsetMs(prefs.subOffsetMs);
    setSubOffsetMs2(prefs.subOffsetMs2);
    subOffsetMsRef.current = prefs.subOffsetMs;
    subOffsetMs2Ref.current = prefs.subOffsetMs2;
    const coerced = coerceSubStyle(prefs.subStyle);
    setSubStyleState(coerced);
    subStyleRef.current = coerced;
    setSubFilterState(prefs.subFilter);
    const v = videoRef.current;
    if (v) {
      try { v.volume = prefs.volume; } catch {}
      try { v.muted = prefs.muted; } catch {}
    }
  }, []);

  // backBuffer live follow (device-local pref) + lastBps seed already wired via engine init
  useEffect(() => {
    const unsub = subscribePrefs((next) => {
      try {
        const bb = next.backBuffer as BackBuffer;
        if (bb === 15 || bb === 30 || bb === 60 || bb === 0) {
          const curHls = hlsRef.current;
          const curDash = dashRef.current;
          if (curHls || curDash) applyBackBufferPref(bb);
        }
      } catch {}
    });
    return () => { try { unsub(); } catch {} };
  }, [applyBackBufferPref]);
  // apply aspectMode -> video.style.objectFit + persist
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    try { video.style.objectFit = aspectModeState as string; } catch {}
  }, [aspectModeState]);
  const applyAspect = useCallback((mode: AspectMode) => {
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    setAspectModeState(mode);
    try { setPrefs({ aspectMode: mode }); } catch {}
    const video = videoRef.current;
    if (video) try { video.style.objectFit = mode as string; } catch {}
    pokeControls();
  }, [pokeControls]);

  const toggleSubFilter = useCallback((next: 'all'|'signs') => {
    setSubFilterState(next);
    subFilterRef.current = next;
    try { setPrefs({ subFilter: next }); } catch {}
    // when filter toggles, migrate primary between native/overlay as needed
    const cur = chosenSubRef.current;
    if (!cur) { pokeControls(); return; }
    const dualActive = dualSubsRef2.current && !!chosenSub2Ref.current;
    const need = needsOverlay(cur.format ?? null, chosenSub2Ref.current?.format ?? null, dualActive, next !== 'all' ? 'signs' : 'all');
    // if ASS with jassub and we switch to signs filter, tear down jassub so overlay filter can run
    if (jassubActiveRef.current && need) {
      jassubActiveRef.current = false;
      jassubAssRef.current = null;
      void destroyJassub().catch(() => undefined);
      // re-attach via stripped cues through applyChosen path
      if (primaryCuesRef.current.length) {
        setPrimaryCuesSync([...primaryCuesRef.current]);
        const video = videoRef.current;
        if (video) { overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime); }
      } else if (subTrackRef.current?.cues) {
        setPrimaryCuesSync([...subTrackRef.current.cues]);
        primaryCuesRef.current = [...subTrackRef.current.cues];
        subTrackRef.current.cleanup(); subTrackRef.current = null;
        const video = videoRef.current;
        if (video) { overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime); }
      }
      pokeControls();
      return;
    }
    // If filter back to all and primary is ASS, re-trigger JASSUB next selection
    if (!need && cur.format && isAssFormat(cur.format) && !jassubActiveRef.current) {
      void applyChosenCaptionsRef.current?.(cur);
    } else if (need && !jassubActiveRef.current) {
      // native -> overlay migration when filter turns on
      const video = videoRef.current;
      if (cur && primaryCuesRef.current.length === 0 && subTrackRef.current?.cues && video) {
        const cues = [...subTrackRef.current.cues];
        subTrackRef.current.cleanup(); subTrackRef.current = null;
        setPrimaryCuesSync(cues); primaryCuesRef.current = cues;
        overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime);
      } else if (cur && primaryCuesRef.current.length && subTrackRef.current?.track) {
        const cues = [...primaryCuesRef.current];
        subTrackRef.current.cleanup(); subTrackRef.current = null;
        setPrimaryCuesSync(cues);
        const video = videoRef.current;
        if (video) { overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime); }
      }
    }
    pokeControls();
  }, [pokeControls, primaryCues]);

  const handleWordClick = useCallback((word: string, cueText: string) => {
    const video = videoRef.current;
    try { video?.pause(); } catch {}
    setLookup({ word: word.replace(/^[.,!?:;'"`(\[]+|[.,!?:;'"`)\]]+$/g, ""), cueText });
    pokeControls();
  }, [pokeControls]);

  const toggleSmartSpeed = useCallback(async (next: boolean) => {
    setSmartSpeedState(next);
    smartSpeedRef.current = next;
    try { setPrefs({ smartSpeed: next }); } catch {}
    const video = videoRef.current;
    if (!video) { pokeControls(); return; }
    if (next) {
      try {
        let handle = smartHandleRef.current;
        if (!handle) {
          handle = createSmartSpeed(video, { silentRate: 1.8 });
          if (handle) smartHandleRef.current = handle;
        }
        if (handle) {
          await handle.resume();
          handle.enable();
        } else {
          flashNotice("Smart speed unavailable on this device");
          setSmartSpeedState(false);
          smartSpeedRef.current = false;
          try { setPrefs({ smartSpeed: false }); } catch {}
        }
      } catch {
        flashNotice("Smart speed unavailable");
        setSmartSpeedState(false);
        smartSpeedRef.current = false;
      }
    } else {
      try { smartHandleRef.current?.disable(); } catch {}
      // restore rate: disable already restores base if boosting
    }
    pokeControls();
  }, [pokeControls, flashNotice]);

  const runSubtitleSearch = useCallback(async () => {
    const title = loaded?.details.title ?? "";
    if (!title.trim()) { flashNotice("No title for search"); return; }
    setSearchLoading(true);
    try {
      const res = await api.subtitleSearch({ provider: searchProvider, title: title.trim(), episode: String(episode ?? ""), lang: getPrefs().prefSubLang?.[0] ?? "en" });
      const incoming: SubtitleOption[] = (res.subtitles ?? []).map((o) => ({ ...o, source: 'search' as const }));
      setSearchResults(incoming);
      if (!incoming.length) { flashNotice("No results from " + searchProvider); return; }
      // merge badged into subOptions, deduped by (url, language, format, forced, sdh)
      setSubOptions((prev) => {
        const keyFor = (o: SubtitleOption) => `${o.url}::${(o.language ?? o.name ?? '').toLowerCase()}::${o.format ?? ''}::${o.forced?1:0}::${o.sdh?1:0}::${o.provider ?? ''}`;
        const seen = new Set(prev.map((p) => keyFor(p)));
        const toAdd: SubtitleOption[] = [];
        for (const opt of incoming) {
          const k = keyFor(opt);
          if (!seen.has(k)) { seen.add(k); toAdd.push(opt); }
        }
        if (!toAdd.length) return prev;
        return [...prev, ...toAdd];
      });
      flashNotice(`Found ${incoming.length} from ${searchProvider}`);
    } catch (e) {
      flashNotice(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearchLoading(false);
    }
  }, [loaded, episode, searchProvider, flashNotice]);



  // apply filter -> video.style.filter
  const filterToCss = useCallback((mode: FilterMode): string => {
    if (mode === "anime") return "saturate(1.25) contrast(1.05)";
    if (mode === "contrast") return "contrast(1.35) saturate(1.1) brightness(1.04)";
    return "none";
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    try { video.style.filter = filterToCss(filterMode); } catch {}
  }, [filterMode, filterToCss]);
  const applyFilter = useCallback((mode: FilterMode) => {
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    setFilterMode(mode);
    try { setPrefs({ filter: mode }); } catch {}
    const video = videoRef.current;
    if (video) try { video.style.filter = filterToCss(mode); } catch {}
    pokeControls();
  }, [filterToCss, pokeControls]);

  // nightDim + brightness -> shared dimmer overlay (reused dimmerRef)
  const computeOverlayOpacity = useCallback((b: number, n: number): number => {
    const brightDim = b < 1 ? 1 - b : 0;
    const nightDimOp = Math.min(0.85, Math.max(0, n * 0.7));
    return Math.min(0.85, Math.max(brightDim, nightDimOp));
  }, []);
  useEffect(() => {
    const el = dimmerRef.current;
    if (!el) return;
    const op = computeOverlayOpacity(brightness, nightDim);
    el.style.opacity = String(op);
    el.style.pointerEvents = "none";
  }, [brightness, nightDim, computeOverlayOpacity]);
  const setNightDim = useCallback((value: number) => {
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    const v = Math.min(1, Math.max(0, value));
    setNightDimState(v);
    try { setPrefs({ nightDim: v }); } catch {}
    const el = dimmerRef.current;
    if (el) el.style.opacity = String(computeOverlayOpacity(brightnessRef.current, v));
    pokeControls();
  }, [pokeControls, computeOverlayOpacity]);
  const setBrightness = useCallback((value: number) => {
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    const v = Math.min(1, Math.max(0.3, value));
    setBrightnessState(v);
    brightnessRef.current = v;
    try { setPrefs({ brightness: v }); } catch {}
    const el = dimmerRef.current;
    if (el) el.style.opacity = String(computeOverlayOpacity(v, nightDim));
    pokeControls();
  }, [pokeControls, nightDim, computeOverlayOpacity]);
  // --- Screen lock / child lock ---
  const clearLockTimers = useCallback(() => {
    if (lockTapTimerRef.current != null) window.clearTimeout(lockTapTimerRef.current);
    if (lockHoldTimerRef.current != null) window.clearTimeout(lockHoldTimerRef.current);
    lockTapTimerRef.current = null;
    lockHoldTimerRef.current = null;
    lockTapCountRef.current = 0;
  }, []);
  const lock = useCallback(() => {
    setLocked(true);
    lockedRef.current = true;
    setLockHint(false);
    clearLockTimers();
    pokeControls();
  }, [clearLockTimers, pokeControls]);
  const unlock = useCallback(() => {
    setLocked(false);
    lockedRef.current = false;
    setLockHint(false);
    clearLockTimers();
    pokeControls();
  }, [clearLockTimers, pokeControls]);
  const handleLockTap = useCallback(() => {
    lockTapCountRef.current += 1;
    if (lockTapTimerRef.current != null) window.clearTimeout(lockTapTimerRef.current);
    lockTapTimerRef.current = window.setTimeout(() => {
      lockTapCountRef.current = 0;
      lockTapTimerRef.current = null;
    }, 600);
    if (lockTapCountRef.current >= 3) unlock();
    else {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 3000);
    }
  }, []);
  const handleLockHoldStart = useCallback(() => {
    if (lockHoldTimerRef.current != null) window.clearTimeout(lockHoldTimerRef.current);
    lockHoldTimerRef.current = window.setTimeout(() => {
      unlock();
      lockHoldTimerRef.current = null;
    }, 1000);
  }, []);
  const handleLockHoldEnd = useCallback(() => {
    if (lockHoldTimerRef.current != null) window.clearTimeout(lockHoldTimerRef.current);
    lockHoldTimerRef.current = null;
  }, []);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  // --- PiP (Picture-in-Picture) ---
  const togglePip = useCallback(async () => {
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement === video) {
      try { await document.exitPictureInPicture(); } catch {}
      setPipActive(false);
    } else {
      try {
        await video.requestPictureInPicture();
        setPipActive(true);
      } catch (e) {
        flashNotice("PiP unavailable");
        console.warn("[pip] request failed", e);
      }
    }
    pokeControls();
  }, [pokeControls, flashNotice]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLeave = () => {
      setPipActive(false);
      pokeControls();
    };
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => video.removeEventListener("leavepictureinpicture", onLeave);
  }, [pokeControls]);

  // --- AirPlay (Safari only) ---
  const canAirPlay = typeof window !== "undefined" && "webkitShowPlaybackTargetPicker" in HTMLVideoElement.prototype;
  const showAirPlay = useCallback(() => {
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    const video = videoRef.current;
    if (!video || !canAirPlay) return;
    try { (video as unknown as { webkitShowPlaybackTargetPicker: () => void }).webkitShowPlaybackTargetPicker(); } catch {}
    pokeControls();
  }, [pokeControls]);

  // --- Stats polling (1s) ---
  useEffect(() => {
    if (!statsOpen) {
      if (statsTimerRef.current != null) {
        window.clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
      }
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    statsTimerRef.current = window.setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      const snap = sampleStats(v, hlsRef.current ?? null, dashRef.current ?? null);
      statsSnapshotRef.current = snap;
      setStatsTick((t) => t + 1);
    }, 1000);
    return () => {
      if (statsTimerRef.current != null) window.clearInterval(statsTimerRef.current);
    };
  }, [statsOpen]);

  const togglePlay = useCallback(() => {
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
    // smartSpeed resume on gesture (autoplay policy)
    if (smartSpeedRef.current && videoRef.current) {
      void smartHandleRef.current?.resume();
    }
    pokeControls();
  }, [pokeControls]);

  const seekBy = useCallback((delta: number) => {
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
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
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (!video.muted && video.volume === 0) {
      video.volume = volumeRef.current || 1;
      setVolume(video.volume);
    }
    try {
      setPrefs({ muted: video.muted, volume: video.volume });
    } catch {}
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else {
      const pr = el.requestFullscreen();
      const after = () => {
        try {
          const o = (screen.orientation as unknown as { lock?: (v: string) => Promise<void> });
          if (o?.lock) void o.lock("landscape").catch(() => undefined);
        } catch {}
      };
      if (pr && typeof (pr as Promise<void>).then === "function") void (pr as Promise<void>).then(after).catch(() => undefined);
      else after();
    }
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
    if (lockedRef.current) {
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    video.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
    volumeRef.current = v;
    try {
      setPrefs({ volume: v, muted: v === 0 });
    } catch {}
  };

  // ---------------- speed: rate + pitch lock helpers ----------------
  const setRate = useCallback((r: number) => {
    if (boostActiveRef.current) {
      const clamped = clampRate(r);
      prevRateRef.current = clamped;
      setPlaybackRateState(clamped);
      playbackRateRef.current = clamped;
      if (ratePersistTimerRef.current != null) window.clearTimeout(ratePersistTimerRef.current);
      ratePersistTimerRef.current = window.setTimeout(() => {
        try { setPrefs({ playbackRate: clampRate(playbackRateRef.current) }); } catch {}
      }, 500);
      pokeControls();
      return;
    }
    const clamped = clampRate(r);
    setPlaybackRateState(clamped);
    playbackRateRef.current = clamped;
    const video = videoRef.current;
    if (video) {
      try { video.playbackRate = clamped; } catch {}
      applyPreservesPitch(video, pitchLockRef.current);
    }
    // Slider drags can fire dozens of times/sec — batch the storage write.
    if (ratePersistTimerRef.current != null) window.clearTimeout(ratePersistTimerRef.current);
    ratePersistTimerRef.current = window.setTimeout(() => {
      try { setPrefs({ playbackRate: clampRate(playbackRateRef.current) }); } catch {}
    }, 500);
    pokeControls();
  }, [applyPreservesPitch, pokeControls]);
  useEffect(() => {
    setRateRef.current = setRate;
  }, [setRate]);
  const togglePitchLock = useCallback(() => {
    const next = !pitchLockRef.current;
    setPitchLockState(next);
    pitchLockRef.current = next;
    const video = videoRef.current;
    if (video) applyPreservesPitch(video, next);
    try { setPrefs({ pitchLock: next }); } catch {}
    pokeControls();
  }, [applyPreservesPitch, pokeControls]);
  const stepFrame = useCallback((dir: 1 | -1) => {
    const video = videoRef.current;
    if (!video) return;
    if (transcodeActiveRef.current) {
      if (!frameStepWarnedRef.current) {
        frameStepWarnedRef.current = true;
        flashNotice("Frame step restarts transcode");
      }
      const pos = absolutePosition();
      const target = pos + dir * 0.1;
      void seekAbsoluteRef.current(target);
      pokeControls();
      return;
    }
    // direct path: 30fps assumption — 1 frame = 1/30s
    const current = video.currentTime;
    const next = frameStep(current, dir, 30); // 30fps assumption
    const dur = video.duration;
    if (!isSeekableDuration(dur)) return;
    const target = clampSeekTarget(next, dur);
    if (target == null) return;
    pinSeekTarget(target);
    try { video.currentTime = target; } catch { pendingSeekRef.current = null; }
    pokeControls();
  }, [absolutePosition, flashNotice, pokeControls, pinSeekTarget]);

  // ---------------- volume boost / normalize (lazy WebAudio graph) ----------------
  // Graph is created once, on first boost/normalize enable. Never created when
  // both remain disabled (zero cost). Mute stays element-level so boost-of-muted
  // stays silent. All AudioContext work is guarded for SSR and never at top-level.
  const applyGainValue = useCallback(() => {
    const g = gainRef.current;
    const ctx = audioCtxRef.current;
    if (!g) return;
    const target = volumeBoostRef.current ? 2.0 : 1.0;
    try {
      if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      if (ctx) {
        try {
          g.gain.cancelScheduledValues(ctx.currentTime);
          g.gain.setTargetAtTime(target, ctx.currentTime, 0.015);
        } catch {}
      }
      g.gain.value = target;
    } catch {
      try { g.gain.value = target; } catch {}
    }
  }, []);

  const applyNormalizeWiring = useCallback(() => {
    const ctx = audioCtxRef.current;
    const src = audioSrcRef.current;
    const gain = gainRef.current;
    const comp = compRef.current;
    if (!ctx || !src || !gain || !comp) return;
    try {
      try { src.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
      try { comp.disconnect(); } catch {}
      if (normalizeGainRef.current) {
        src.connect(gain);
        gain.connect(comp);
        comp.connect(ctx.destination);
      } else {
        src.connect(gain);
        gain.connect(ctx.destination);
      }
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    } catch (e) {
      console.warn("[audio] normalize wiring failed", e);
    }
  }, []);

  const ensureAudioGraph = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    if (graphReadyRef.current) return true;
    const video = videoRef.current;
    if (!video) return false;
    // Prefixed AudioContext for old Safari; assign to named const before member access
    const audioWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }; // well-known DOM AudioContext
    const Ctx = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!Ctx) return false;
    try {
      const ctx = new Ctx();
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch {}
      }
      const src = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();
      gain.gain.value = volumeBoostRef.current ? 2.0 : 1.0;
      const comp = ctx.createDynamicsCompressor();
      try {
        comp.threshold.value = -24;
        comp.knee.value = 30;
        comp.ratio.value = 12;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;
      } catch {}
      // Wire according to current normalize pref
      if (normalizeGainRef.current) {
        src.connect(gain);
        gain.connect(comp);
        comp.connect(ctx.destination);
      } else {
        src.connect(gain);
        gain.connect(ctx.destination);
      }
      audioCtxRef.current = ctx;
      audioSrcRef.current = src;
      gainRef.current = gain;
      compRef.current = comp;
      graphReadyRef.current = true;
      return true;
    } catch (e) {
      console.warn("[audio] graph init failed", e);
      return false;
    }
  }, []);

  const setVolumeBoostEnabled = useCallback(async (next: boolean) => {
    volumeBoostRef.current = next;
    setVolumeBoost(next);
    try { setPrefs({ volumeBoost: next }); } catch {}
    if (next) {
      const ok = await ensureAudioGraph();
      if (ok) applyGainValue();
      else {
        // Fallback: no AudioContext support — keep pref but no boost
        flashNotice("Boost unavailable on this device");
      }
    } else if (graphReadyRef.current) {
      applyGainValue();
    }
    pokeControls();
  }, [ensureAudioGraph, applyGainValue, pokeControls, flashNotice]);

  const setNormalizeEnabled = useCallback(async (next: boolean) => {
    normalizeGainRef.current = next;
    setNormalizeOn(next);
    try { setPrefs({ normalize: next }); } catch {}
    if (next && !graphReadyRef.current) {
      const ok = await ensureAudioGraph();
      if (!ok) {
        flashNotice("Normalize unavailable on this device");
        return;
      }
      // ensureAudioGraph already wired for normalize=true
      pokeControls();
      return;
    }
    if (graphReadyRef.current) applyNormalizeWiring();
    pokeControls();
  }, [ensureAudioGraph, applyNormalizeWiring, pokeControls, flashNotice]);
  // Hydration restore: if boost/normalize persisted as on, lazily build graph
  // once the element exists (still zero cost when both remain off).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (graphReadyRef.current) return;
    if (!volumeBoost && !normalizeOn) return;
    if (!videoRef.current) return;
    void ensureAudioGraph().catch(() => undefined);
  }, [volumeBoost, normalizeOn, ensureAudioGraph]);
  // P4: smartSpeed hydration — SSR-guarded, single source per stable element
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!smartSpeed) return;
    const video = videoRef.current;
    if (!video) return;
    let handle = smartHandleRef.current;
    if (!handle) {
      handle = createSmartSpeed(video, { silentRate: 1.8 });
      if (handle) smartHandleRef.current = handle;
    }
    if (!handle) return;
    void handle.resume().catch(() => undefined);
    handle.enable();
    const onVis = () => {
      if (document.visibilityState === "visible") void handle?.resume().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVis);
    // also ensure not stuck: when disabled re-enable restores base rate; when paused, tick no-ops
    const onEnded = () => {
      try { handle?.disable(); } catch {}
    };
    video.addEventListener("ended", onEnded);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      video.removeEventListener("ended", onEnded);
      try { handle?.disable(); } catch {}
    };
  }, [smartSpeed]);
  // Pause/resume smartSpeed when element pauses/plays so silence ramp doesn't stick
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPause = () => {
      if (smartSpeedRef.current) {
        try { smartHandleRef.current?.disable(); } catch {}
        // keep handle alive; re-enable on play via the hydration effect's handle
        // simpler: if still enabled pref, re-enable on next play
        if (smartSpeedRef.current && videoRef.current) {
          // delay to avoid immediate re-ramp on pause tick
        }
      }
    };
    const onPlay = () => {
      if (smartSpeedRef.current) {
        const h = smartHandleRef.current ?? createSmartSpeed(video, { silentRate: 1.8 });
        if (h) {
          smartHandleRef.current = h;
          void h.resume().catch(() => undefined);
          h.enable();
        }
      }
    };
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
    };
  }, []);

  /**
   * Restart the transcode pipeline at an absolute source offset and resume on
   * the fresh playlist. The HLS engine is only torn down AFTER the backend
   * accepted the seek, so a refused request (409/422/network) leaves the
   * current stream playing untouched.
   */
  const remoteSeek = useCallback(
    async (absSeconds: number) => {
      if (lockedRef.current) {
        setLockHint(true);
        if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
        lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
        return;
      }
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
            // Backend recycle / restart mid-seek: the old playlist may still serve
            // while the new pipeline warms — the indexHasSegments check below covers it.
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
      if (lockedRef.current) {
        setLockHint(true);
        if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
        lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
        return;
      }
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
    if (!autoplay) {
      // autoplay off: static card, no countdown
      return;
    }
    nextCountdown.current = autoplayDelay;
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
  }, [nextUp, router, provider, id, showNextUp, autoplay, autoplayDelay]);

  useDismissable(subsOpen, subsMenuRef, () => setSubsOpen(false));
  useDismissable(speedOpen, speedMenuRef, () => setSpeedOpen(false));
  useDismissable(episodeDrawerOpen, episodeDrawerRef, () => setEpisodeDrawerOpen(false));
  useDismissable(volPopoverOpen, volMenuRef, () => setVolPopoverOpen(false));
  useDismissable(aspectOpen, aspectMenuRef, () => setAspectOpen(false));
  useDismissable(filterOpen, filterMenuRef, () => setFilterOpen(false));

  // overlay clock: keep overlayNow in sync while overlay is active (dual/ASS/filter)
  // Lightweight tick — only while needed, via rAF that updates state ~5-10fps throttled
  useEffect(() => {
    const needs = (
      (dualSubs && !!chosenSub && !!chosenSub2) ||
      (chosenSub && (chosenSub.format === 'ass' || chosenSub.format === 'ssa')) ||
      (chosenSub2 && (chosenSub2.format === 'ass' || chosenSub2.format === 'ssa')) ||
      (subFilter !== 'all')
    );
    // also if primary is currently via overlay (primaryCues length >0) needs tick
    const overlayActive = needs || primaryCues.length > 0 || secondaryCues.length > 0;
    if (!overlayActive) return;
    let raf = 0;
    let last = 0;
    const loop = () => {
      const now = performance.now();
      if (now - last > 100) { // 10fps sufficient for cues (1s granularity), saves re-renders
        const cur = absolutePosition();
        // only trigger state if should change active set? but cheap to set even if same — overlay component will filter
        overlayNowRef.current = cur;
        setOverlayNow(cur);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dualSubs, chosenSub, chosenSub2, subFilter, primaryCues.length, secondaryCues.length, absolutePosition]);

  // keep native ::cue vars in sync with subStyle
  useEffect(() => {
    const vars = styleToCssVars(subStyle);
    const vEl = videoRef.current;
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!vEl && !root) return;
    try { Object.entries(vars).forEach(([k,v]) => { if(vEl) try{ vEl.style.setProperty(k,v);}catch{}; if(root) try{ root.style.setProperty(k,v);}catch{}; }); } catch {}
  }, [subStyle]);

  // Keep sub prefs in sync if changed elsewhere (account sync / another tab)
  useEffect(() => {
    const unsub = subscribePrefs((next) => {
      // subStyle is in sync subset, device-local for offsets/dual
      try { const ns = coerceSubStyle(next.subStyle, DEFAULT_SUB_STYLE); if (JSON.stringify(ns)!==JSON.stringify(subStyleRef.current)) { setSubStyleState(ns); subStyleRef.current=ns; } } catch {}
      // subFilter / dual / offsets are device-local but listen for manual setPrefs in same tab
      if (typeof next.subFilter === 'string' && (next.subFilter==='all'||next.subFilter==='signs')) {
        if (next.subFilter !== subFilterRef.current) { setSubFilterState(next.subFilter as 'all'|'signs'); subFilterRef.current = next.subFilter as 'all'|'signs'; }
      }
      if (typeof next.dualSubs === 'boolean' && next.dualSubs !== dualSubsRef2.current) {
        setDualSubsState(next.dualSubs); dualSubsRef2.current=next.dualSubs;
      }
      if (typeof next.subOffsetMs === 'number' && next.subOffsetMs !== subOffsetMsRef.current) {
        setSubOffsetMs(next.subOffsetMs); subOffsetMsRef.current = next.subOffsetMs;
      }
      if (typeof next.subOffsetMs2 === 'number' && next.subOffsetMs2 !== subOffsetMs2Ref.current) {
        setSubOffsetMs2(next.subOffsetMs2); subOffsetMs2Ref.current = next.subOffsetMs2;
      }
    });
    return () => { try{ unsub(); }catch{} };
  }, []);

  // Auto-migrate primary between native and overlay when filter toggles
  useEffect(() => {
    const cur = chosenSubRef.current;
    if (!cur) return;
    const need = needsOverlay(cur.format ?? null, chosenSub2Ref.current?.format ?? null, dualSubsRef2.current && !!chosenSub2Ref.current, subFilter !== 'all' ? 'signs':'all');
    const hasOverlay = primaryCues.length > 0;
    const hasNative = !!subTrackRef.current?.track;
    if (need && hasNative) {
      const cues = subTrackRef.current?.cues ? [...subTrackRef.current.cues] : [...primaryCuesRef.current];
      if (!cues.length) return;
      const video = videoRef.current;
      if (!video) return;
      subTrackRef.current?.cleanup(); subTrackRef.current=null;
      setPrimaryCuesSync(cues); primaryCuesRef.current=cues;
      if(video){ overlayNowRef.current=video.currentTime; setOverlayNow(video.currentTime); }
    } else if (!need && hasOverlay) {
      const cues = [...primaryCuesRef.current];
      if (!cues.length) return;
      const video = videoRef.current;
      if (!video) return;
      setPrimaryCuesSync([]); primaryCuesRef.current=cues;
      const state = attachSubtitleTrack(video, cur.name, cues,{offsetMs: subOffsetMsRef.current, source:'native'});
      state.cues=[...cues]; (state as any).offsetMs=subOffsetMsRef.current;
      subTrackRef.current=state;
      const vars=styleToCssVars(subStyleRef.current);
      try{ const el=containerRef.current??video; Object.entries(vars).forEach(([k,v])=> el.style.setProperty(k,v)); }catch{}
    }
  }, [subFilter, primaryCues]);


  // Keep season tab in sync with current episode's season
  useEffect(() => {
    if (loaded?.details.seasons?.length) {
      const nums = loaded.details.seasons.map((s) => s.number);
      if (activeSeasonTab == null || !nums.includes(activeSeasonTab)) {
        setActiveSeasonTab(season || nums[0] || null);
      }
    }
  }, [loaded, season, activeSeasonTab]);

  // Keep autoplay prefs in sync if changed elsewhere (e.g., account sync)
  useEffect(() => {
    try {
      const p = getPrefs();
      setAutoplay(p.autoplay);
      setAutoplayDelay(p.autoplayDelay);
    } catch {}
    const unsub = subscribePrefs((next) => {
      setAutoplay(next.autoplay);
      setAutoplayDelay(next.autoplayDelay);
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  // P1Seek — keep seekStep/timeMode in sync with external pref changes
  useEffect(() => {
    try {
      const p = getPrefs();
      setSeekStepState(resolveSeekStep(p.seekStep));
      const tm = p.timeMode;
      setTimeModeState(tm === 'elapsed' || tm === 'remaining' ? tm : 'elapsed');
    } catch {}
    const unsub = subscribePrefs((next) => {
      setSeekStepState(resolveSeekStep(next.seekStep));
      const tm = next.timeMode;
      setTimeModeState(tm === 'elapsed' || tm === 'remaining' ? tm : 'elapsed');
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  // ------ Prefetch worker (07.4): warm next-episode manifests + 2-3 heads at >0.8 progress ------
  const prefetchWorkerRef = useRef<Worker | null>(null);
  const prefetchFiredRef = useRef(false);
  const getPrefetchWorker = () => {
    if (typeof window === 'undefined') return null;
    if (prefetchWorkerRef.current) return prefetchWorkerRef.current;
    try {
      const w = new Worker(new URL("../workers/prefetch.ts", import.meta.url));
      prefetchWorkerRef.current = w;
      return w;
    } catch { return null; }
  };
  // Fire once per episode when crossing 0.8 progress or entering end credits
  useEffect(() => {
    if (!loaded) return;
    const next = nextEpisode(loaded.details.seasons ?? [], season, episode);
    if (!next) return;
    // Poll every 5s for the 0.8 crossing — effect deps (functions) don't tick with playback
    const check = () => {
      if (prefetchFiredRef.current) return;
      const dur = absoluteDuration();
      const pos = absolutePosition();
      let shouldWarm = false;
      if (dur > 0 && pos / dur > 0.8) shouldWarm = true;
      if (!shouldWarm) return;
      prefetchFiredRef.current = true;
      const worker = getPrefetchWorker();
      (async () => {
        try {
          let playUrl: string | undefined;
          let manifestUrls: string[] = [];
          try {
            const playRes = await api.play({ provider, id, season: next.season, episode: next.episode } as unknown as Record<string, unknown> as never);
            playUrl = playRes.play_url;
            manifestUrls = [playRes.play_url];
          } catch {}
          // Warm via worker into caches.open('prefetch-v1') — NEVER auto-POST /transcode/start
          if (worker) {
            try { worker.postMessage({ type: 'prefetch', provider, id, season: next.season, episode: next.episode, playUrl, manifestUrls }); } catch {}
          } else {
            try {
              const cache = await caches.open('prefetch-v1');
              for (const u of manifestUrls.slice(0, 3)) {
                try {
                  const r = await fetch(u, { cache: 'no-store', priority: 'low' } as unknown as RequestInit);
                  if (r.ok) await cache.put(u, r.clone());
                } catch {}
              }
            } catch {}
          }
        } catch {}
      })();
    };
    // immediate check (for already-past threshold on load) + interval
    check();
    const iv = window.setInterval(check, 5000);
    return () => window.clearInterval(iv);
  }, [loaded, season, episode, provider, id, absoluteDuration, absolutePosition]);
  // Reset prefetch gate when season/episode changes
  useEffect(() => { prefetchFiredRef.current = false; }, [season, episode, id]);
  // Cleanup worker on unmount
  useEffect(() => { return () => { const w = prefetchWorkerRef.current; if (w) { try { w.terminate(); } catch {} prefetchWorkerRef.current = null; } }; }, []);


  const adjustOffset = useCallback((which: 'primary'|'secondary', deltaMs: number) => {
    const video = videoRef.current;
    const clamp = (v: number) => Math.max(-2000, Math.min(2000, Math.round(v)));
    if (which === 'primary') {
      const next = clamp((subOffsetMsRef.current ?? 0) + deltaMs);
      subOffsetMsRef.current = next; setSubOffsetMs(next);
      persistOffset('subOffsetMs', next);
      const sign = next > 0 ? '+' : '';
      flashNotice(`Subs ${sign}${next}ms`);
      // native path: re-attach with shifted cues if not overlay
      const need = needsOverlay(chosenSubRef.current?.format ?? null, chosenSub2Ref.current?.format ?? null, dualSubsRef2.current && !!chosenSub2Ref.current, (subFilterRef.current ?? 'all') !== 'all' ? 'signs':'all');
      if (!need && subTrackRef.current && video && chosenSubRef.current) {
        const cues = subTrackRef.current.cues ? [...subTrackRef.current.cues] : [...primaryCuesRef.current];
        if (cues.length) {
          subTrackRef.current.cleanup();
          const state = attachSubtitleTrack(video, chosenSubRef.current.name, cues,{offsetMs: next, source:'native'});
          subTrackRef.current=state;
        }
      } else {
        // overlay: just re-tick so filter picks shifted window
        if (video) { overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime); }
      }
    } else {
      const next = clamp((subOffsetMs2Ref.current ?? 0) + deltaMs);
      subOffsetMs2Ref.current = next; setSubOffsetMs2(next);
      persistOffset('subOffsetMs2', next);
      const sign = next > 0 ? '+' : '';
      flashNotice(`Subs2 ${sign}${next}ms`);
      if (video) { overlayNowRef.current = video.currentTime; setOverlayNow(video.currentTime); }
    }
    pokeControls();
  }, [flashNotice, pokeControls]);

  const updateSubStyle = (patch: Partial<SubStyle>) => {
    const next = coerceSubStyle({ ...subStyleRef.current, ...patch }, DEFAULT_SUB_STYLE);
    setSubStyleState(next);
    subStyleRef.current = next;
    try { setPrefs({ subStyle: next }); } catch {}
    // native vars update via effect, but also immediate for overlay preview
    const vars = styleToCssVars(next);
    const vEl = videoRef.current;
    if (vEl) try { Object.entries(vars).forEach(([k,v])=> { try{ vEl.style.setProperty(k,v);}catch{}; try{ document.documentElement.style.setProperty(k,v);}catch{}; }); } catch{}
    pokeControls();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "SELECT" || (target as HTMLElement)?.isContentEditable) return;
      if (lockedRef.current) {
        setLockHint(true);
        if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
        lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
        return;
      }
      const shifted = e.shiftKey;
      if (e.key === 'g' || e.key === 'G') {
        if (chosenSubRef.current || primaryCuesRef.current.length || primaryCues.length) {
          e.preventDefault();
          const delta = shifted ? -500 : -100;
          adjustOffset('primary', delta);
        }
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        if (chosenSubRef.current || primaryCuesRef.current.length || primaryCues.length) {
          e.preventDefault();
          const delta = shifted ? 500 : 100;
          adjustOffset('primary', delta);
        }
        return;
      }
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(-seekStepRef.current);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(seekStepRef.current);
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
        case ",":
          e.preventDefault();
          stepFrame(-1);
          break;
        case ".":
          e.preventDefault();
          stepFrame(1);
          break;
        case "Escape":
          if (subsOpen) setSubsOpen(false);
          else if (speedOpen) setSpeedOpen(false);
          else if (volPopoverOpen) setVolPopoverOpen(false);
          else if (episodeDrawerOpen) setEpisodeDrawerOpen(false);
          else if (statsOpen) {
            setStatsOpen(false);
            try { setPrefs({ statsOpen: false }); } catch {}
          } else if (aspectOpen) setAspectOpen(false);
          else if (filterOpen) setFilterOpen(false);
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
  }, [togglePlay, seekBy, toggleMute, toggleFullscreen, nextUp, resumeAsk, router, subsOpen, speedOpen, episodeDrawerOpen, volPopoverOpen, stepFrame, statsOpen, aspectOpen, filterOpen, adjustOffset]);

  // ---------------- skip intro/outro detection ----------------
  useEffect(() => {
    const id = window.setInterval(() => {
      const chaps = (loaded?.streams as (StreamsResponse & { chapters?: Chapter[] }))?.chapters;
      if (!chaps || chaps.length === 0) {
        if (skipChapter) setSkipChapter(null);
        return;
      }
      const pos = absolutePosition();
      const found = chaps.find((c) => (c.kind === 'intro' || c.kind === 'outro') && pos >= c.start && pos < c.end) ?? null;
      if ((found?.start ?? null) !== (skipChapter?.start ?? null) || (found?.end ?? null) !== (skipChapter?.end ?? null)) {
        setSkipChapter(found);
      }
    }, 600);
    return () => window.clearInterval(id);
  }, [loaded, absolutePosition, skipChapter]);

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
          if (timeRef.current) timeRef.current.textContent = timeModeRef.current === 'remaining' ? formatRemaining(displayTime, duration) : formatClock(displayTime);
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
    if (lockedRef.current) {
      draggingRef.current = false;
      setLockHint(true);
      if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
      lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
      return;
    }
    draggingRef.current = false;
    const value = Number(target.value);
    if (!Number.isFinite(value)) return;
    void seekAbsoluteRef.current(value);
  };


  // ---------- P3 gestures: double-tap, swipe, hold-boost, pinch ----------
  const holdBoostRateRef = useRef<import("@/lib/player-prefs").HoldBoostRate>(2 as HoldBoostRate);
  // keep holdBoostRate in sync with prefs
  useEffect(() => {
    try { holdBoostRateRef.current = getPrefs().holdBoostRate; } catch {}
    const unsub = subscribePrefs((next) => { holdBoostRateRef.current = next.holdBoostRate; });
    return () => { try { unsub(); } catch {} };
  }, []);
  // throttling refs for swipe flash
  const lastBrightnessFlashRef = useRef(0);
  const lastVolumeFlashRef = useRef(0);
  const gestureHandlers = useGestures({
    lockedRef,
    seekStepRef,
    pokeControls,
    flashNotice,
    onSingleTap: () => {
      togglePlay();
    },
    onDoubleTapSeek: (side, jump) => {
      // side determines direction; hook passes jump already scaled by jumpForTaps
      const delta = side === "left" ? -jump : jump;
      // flash + side effect
      const label = `${delta > 0 ? "+" : ""}${delta}s`;
      // transient side flash animation
      setSideFlash(side);
      if (sideFlashTimerRef.current != null) window.clearTimeout(sideFlashTimerRef.current);
      sideFlashTimerRef.current = window.setTimeout(() => {
        sideFlashTimerRef.current = null;
        setSideFlash((cur) => (cur === side ? null : cur));
      }, 300);
      flashNotice(label);
      seekBy(delta);
    },
    onSwipe: (side, dy) => {
      if (side === "right") {
        if (gestureVolumeStartRef.current == null) gestureVolumeStartRef.current = volumeRef.current;
        const start = gestureVolumeStartRef.current ?? 1;
        const next = Math.min(1, Math.max(0, start - dy * 0.004));
        onVolume(next);
        const now = Date.now();
        if (now - lastVolumeFlashRef.current > 180) {
          lastVolumeFlashRef.current = now;
          flashNotice(`Volume ${Math.round(next * 100)}%`);
        }
      } else if (side === "left") {
        if (gestureBrightnessStartRef.current == null) gestureBrightnessStartRef.current = brightnessRef.current;
        const start = gestureBrightnessStartRef.current ?? 1;
        const next = Math.min(1, Math.max(0.3, start - dy * 0.004));
        setBrightness(next);
        const now = Date.now();
        if (now - lastBrightnessFlashRef.current > 180) {
          lastBrightnessFlashRef.current = now;
          flashNotice(`Brightness ${Math.round(next * 100)}%`);
        }
      }
    },
    onHoldStart: () => {
      const video = videoRef.current;
      if (!video) return;
      if (boostActiveRef.current) return;
      prevRateRef.current = video.playbackRate;
      boostActiveRef.current = true;
      const rate = holdBoostRateRef.current ?? 2;
      try { video.playbackRate = rate; } catch {}
      flashNotice(`${rate}× speed`);
      pokeControls();
    },
    onHoldEnd: () => {
      const video = videoRef.current;
      if (!boostActiveRef.current) {
        // still clear prev to avoid stale restore on next hold
        prevRateRef.current = null;
        return;
      }
      boostActiveRef.current = false;
      const prev = prevRateRef.current;
      prevRateRef.current = null;
      if (video && prev != null && Number.isFinite(prev)) {
        try { video.playbackRate = prev; } catch {}
        // keep state ref in sync (do not persist boosted rate)
        playbackRateRef.current = prev;
        setPlaybackRateState(prev);
      }
      // reset swipe starts after hold
      gestureVolumeStartRef.current = null;
      gestureBrightnessStartRef.current = null;
      pokeControls();
    },
    onPinch: (scale) => {
      if (scale > 1.15 && pinchAppliedRef.current !== "cover") {
        pinchAppliedRef.current = "cover";
        applyAspect("cover");
        flashNotice("Zoom: fill");
      } else if (scale < 0.9 && pinchAppliedRef.current !== "contain") {
        pinchAppliedRef.current = "contain";
        applyAspect("contain");
        flashNotice("Zoom: fit");
      }
    },
  });
  // Reset pinch/swipe starts when gesture ends (pointer up without hold)
  const handleGesturePointerUp = useCallback((e: React.PointerEvent) => {
    gestureHandlers.onPointerUp(e);
    // if no pointers remain, reset gesture start refs and pinch throttle
    // active pointers count is internal to hook; we approximate by resetting on any up when not holding
    if (!boostActiveRef.current) {
      // delay reset to allow trailing swipe commits (hook's debounce is 400ms, but starts are per-sequence)
      // We reset starts only after a pause; simplest reset now if not boosting
      // For swipes, hook resets suppression after up; we reset volumes
      // Use timeout to ensure we don't reset mid-multi-tap sequence — keep until commit
      // For volume/brightness, reset if dy reset is desired for next swipe sequence
      // Heuristic: if both pointers lifted, reset
      // Since we don't know active count, just reset brightness/volume starts after a short delay
      // Actually we want starts to persist within one continuous swipe; the hook's isSwiping flag handles.
      // So we reset only when swipe ends: isSwiping was true and now ends.
      // We can't introspect; just reset after each up if not in a tap debounce.
      // Safer to reset on next down via onPointerDown side-effect; so keep starts until next gesture down resets explicitly?
      // We'll reset here opportunistically but keep pinchApplied hysteresis across gesture.
    }
    // pinch hysteresis reset after gesture lifts — allow re-trigger on next fresh pinch
    // Keep pinchAppliedRef across lifts only for a short window; reset after 400ms to allow toggling again
    window.setTimeout(() => { pinchAppliedRef.current = null; }, 400);
  }, [gestureHandlers]);
  const handleGesturePointerDown = useCallback((e: React.PointerEvent) => {
    // reset per-sequence swipe starts for fresh gesture
    // Do not reset during multi-tap debounce? Keep start null until swipe triggers; resetting here is safe
    gestureVolumeStartRef.current = null;
    gestureBrightnessStartRef.current = null;
    gestureHandlers.onPointerDown(e);
  }, [gestureHandlers]);

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
        style={{ objectFit: aspectModeState, filter: filterToCss(filterMode) } as React.CSSProperties}
      />
      {/* gesture layer — transparent, touch-action:none, below controls (z-10) */}
      <div
        className="gesture-layer"
        onPointerDown={handleGesturePointerDown}
        onPointerMove={gestureHandlers.onPointerMove}
        onPointerUp={handleGesturePointerUp}
        onPointerCancel={gestureHandlers.onPointerCancel}
        aria-hidden
      />
      {/* side flash indicators for double-tap */}
      {sideFlash === "left" && <div className="side-flash side-flash--left" aria-hidden />}
      {sideFlash === "right" && <div className="side-flash side-flash--right" aria-hidden />}
      {/* Subtitle overlay(s) — active only when overlay path engages (dual/ASS/filter) */}
      {/* single primary via overlay — never native TextTrack when this renders */}
      {primaryCues.length > 0 && !jassubActiveRef.current && (
        <SubtitleOverlay cues={primaryCues} style={subStyle} slot="bottom" currentTime={overlayNow} offsetMs={subOffsetMs} filter={subFilter} interactive onWordClick={handleWordClick} />
      )}
      {/* dual secondary top slot — only when both tracks chosen */}
      {dualSubs && chosenSub && chosenSub2 && secondaryCues.length > 0 && (
        <SubtitleOverlay cues={secondaryCues} style={subStyle} slot="top" currentTime={overlayNow} offsetMs={subOffsetMs2} filter={subFilter} interactive onWordClick={handleWordClick} />
      )}
      {/* word lookup selection — pause + token only (dictionary fetch follow-up) */}
      {lookup && (
        <div className="absolute bottom-[18%] left-1/2 z-[22] -translate-x-1/2 rounded-lg border border-white/15 bg-black/85 px-3 py-2 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="mono-meta text-[10px] font-bold tracking-[0.2em] text-brand">LOOKUP</span>
            <button
              onClick={() => setLookup(null)}
              aria-label="Close lookup"
              className="ml-auto grid h-6 w-6 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
            >
              <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <p className="mt-1 text-sm font-bold text-white">{lookup.word}</p>
          <p className="mt-0.5 max-w-[min(80vw,380px)] truncate text-xs text-zinc-400">{lookup.cueText}</p>
          <p className="mono-meta mt-1 text-[10px] tracking-widest text-zinc-500">Dictionary lookup — coming soon</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => { setLookup(null); void videoRef.current?.play().catch(() => undefined); }} className="rounded-md bg-white px-3 py-1.5 text-xs font-bold text-black hover:bg-zinc-200">Resume</button>
            <button onClick={() => setLookup(null)} className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">Dismiss</button>
          </div>
        </div>
      )}
      <div
        ref={dimmerRef}
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-200"
        style={{ opacity: Math.min(0.85, Math.max(brightness < 1 ? 1 - brightness : 0, nightDim > 0 ? Math.min(0.85, Math.max(0, nightDim * 0.7)) : 0)) }}
        aria-hidden
      />

      {/* top scrim + back */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${
          controls ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`absolute left-0 top-0 z-30 flex w-full items-center gap-4 p-5 transition-opacity duration-300 md:p-7 ${
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
        {/* Screen lock button (top bar) */}
        <button
          onClick={() => {
            if (locked) handleLockTap();
            else lock();
          }}
          onPointerDown={locked ? handleLockHoldStart : undefined}
          onPointerUp={locked ? handleLockHoldEnd : undefined}
          onPointerLeave={locked ? handleLockHoldEnd : undefined}
          aria-label={locked ? "Unlock screen" : "Lock screen"}
          className="ml-auto grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
          title={locked ? "Triple-tap or hold 1s to unlock" : "Lock screen"}
        >
          {locked ? <UnlockIcon width={20} height={20} /> : <LockIcon width={20} height={20} />}
        </button>
        {/* Episode drawer button (top bar) */}
        {loaded?.details.seasons && loaded.details.seasons.length > 0 && (
          <button
            onClick={() => {
              setEpisodeDrawerOpen((o) => !o);
              pokeControls();
            }}
            aria-label="Episodes"
            aria-expanded={episodeDrawerOpen}
            className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
          >
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 8h10M7 12h10M7 16h10" />
            </svg>
          </button>
        )}
      </div>


      {/* episode drawer — right-side, fullscreen-safe (inside containerRef) */}
      {episodeDrawerOpen && loaded?.details.seasons && (
        <div className="absolute inset-0 z-30 flex justify-end bg-black/40 backdrop-blur-[1px]" onClick={() => setEpisodeDrawerOpen(false)}>
          <div
            ref={episodeDrawerRef}
            onClick={(e) => e.stopPropagation()}
            className="glass-panel flex h-full w-[min(88vw,380px)] flex-col overflow-hidden border-l border-white/10"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="eyebrow text-brand">EPISODES</p>
              <button
                onClick={() => setEpisodeDrawerOpen(false)}
                aria-label="Close episodes"
                className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
              >
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
            {loaded.details.seasons.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto border-b border-white/10 px-3 py-2 scrollbar-none">
                {loaded.details.seasons
                  .slice()
                  .sort((a, b) => a.number - b.number)
                  .map((s) => (
                    <button
                      key={s.number}
                      onClick={() => setActiveSeasonTab(s.number)}
                      className={`mono-meta shrink-0 rounded-full px-3 py-1.5 text-xs font-bold tracking-widest transition ${activeSeasonTab === s.number ? "bg-brand text-white" : "bg-white/10 text-zinc-300 hover:bg-white/20"}`}
                    >
                      S{s.number}
                    </button>
                  ))}
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {(() => {
                  const seasonsSorted = loaded.details.seasons.slice().sort((a, b) => a.number - b.number);
                  const activeSeason = seasonsSorted.find((s) => s.number === activeSeasonTab) ?? seasonsSorted[0];
                  if (!activeSeason) return null;
                  const eps = activeSeason.episodes.slice().sort((a, b) => a.number - b.number);
                  return eps.map((ep) => {
                    const isCurrent = activeSeason.number === season && ep.number === episode;
                    return (
                      <button
                        key={`${activeSeason.number}-${ep.number}`}
                        onClick={() => {
                          setEpisodeDrawerOpen(false);
                          router.push(`/watch/${provider}/${id}?s=${activeSeason.number}&e=${ep.number}`);
                        }}
                        className={`flex flex-col items-center justify-center rounded-lg border px-2 py-3 text-center transition ${isCurrent ? "border-brand bg-brand/20 text-brand" : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"}`}
                      >
                        <span className="text-sm font-bold">{ep.number}</span>
                        <span className="mt-0.5 line-clamp-1 max-w-full text-[10px] leading-tight opacity-70">{ep.title ?? `Episode ${ep.number}`}</span>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Screen lock overlay (when locked) */}
      {locked && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/55 backdrop-blur-[1px]"
          onClick={handleLockTap}
          onPointerDown={handleLockHoldStart}
          onPointerUp={handleLockHoldEnd}
          onPointerLeave={handleLockHoldEnd}
          role="button"
          tabIndex={0}
          aria-label="Unlock"
        >
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/70 px-6 py-5 ring-1 ring-white/15 backdrop-blur">
            <LockIcon width={28} height={28} className="text-white" />
            <p className="mono-meta text-xs font-bold tracking-[0.2em] text-white">SCREEN LOCKED</p>
            <p className="text-center text-xs text-zinc-300">
              {lockHint ? "Triple-tap or hold 1s to unlock" : "Tap to show unlock hint"}
            </p>
            {lockHint && <p className="mono-meta text-[11px] tracking-widest text-brand">Triple-tap or hold lock icon 1s</p>}
            <button
              onClick={(e) => { e.stopPropagation(); handleLockTap(); }}
              onPointerDown={(e) => { e.stopPropagation(); handleLockHoldStart(); }}
              onPointerUp={(e) => { e.stopPropagation(); handleLockHoldEnd(); }}
              aria-label="Unlock screen"
              className="mt-1 grid h-12 w-12 place-items-center rounded-full bg-white/10 ring-1 ring-white/20 transition hover:bg-white/20"
            >
              <UnlockIcon width={22} height={22} className="text-white" />
            </button>
          </div>
        </div>
      )}
      {/* Stats overlay (mono) */}
      {statsOpen && (
        <StatsOverlay stats={statsSnapshotRef.current} />
      )}

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
          onClick={() => {
            if (endedRef.current) {
              endedRef.current = false;
              seekAbsoluteRef.current(0);
              void videoRef.current?.play();
              recordWatch(
                { provider, id, season, episode, title: loaded?.details.title ?? label.replace(/ · S\d+ E\d+$/, ""), poster: loaded?.details.poster_url ?? null, mediaType: loaded?.details.media_type ?? (season > 0 ? "series" : "movie"), year: loaded?.details.year ?? null, position: 0, duration: absoluteDuration() },
                authedRef.current,
                false,
              );
            } else {
              togglePlay();
            }
          }}
          aria-label={endedRef.current ? "Replay" : "Play"}
          className="absolute inset-0 z-20 grid place-items-center"
        >
          <span className="grid h-24 w-24 place-items-center rounded-full bg-white/10 ring-1 ring-white/30 backdrop-blur-md transition hover:scale-105 hover:bg-white/20">
            {endedRef.current ? (
              <ReplayIcon width={38} height={38} className="translate-x-1 text-white" />
            ) : (
              <PlayIcon width={38} height={38} className="translate-x-1 text-white" />
            )}
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
              {autoplay ? (
                <span className="text-sm font-semibold text-zinc-300">{Math.max(0, nextCountdown.current)}s</span>
              ) : (
                <span className="mono-meta text-xs font-semibold tracking-widest text-zinc-400">PAUSED</span>
              )}
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
            <label className="flex cursor-pointer items-center gap-2 border-t border-white/10 px-5 py-3 text-sm text-zinc-300 hover:bg-white/[0.04]">
              <input
                type="checkbox"
                checked={!autoplay}
                onChange={(e) => {
                  const dont = e.target.checked;
                  const nextVal = !dont;
                  setAutoplay(nextVal);
                  try { setPrefs({ autoplay: nextVal }); } catch {}
                  pokeControls();
                }}
                className="h-4 w-4 rounded border-white/20 bg-transparent accent-brand"
              />
              <span>Don&apos;t autoplay</span>
            </label>
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
          {skipChapter && (
            <div className="pointer-events-auto absolute bottom-[88px] left-1/2 z-20 flex -translate-x-1/2 gap-2">
              <button
                onClick={() => {
                  seekAbsoluteRef.current(skipChapter.end);
                  flashNotice(skipChapter.kind === 'intro' ? "Intro skipped" : "Outro skipped");
                  setSkipChapter(null);
                  pokeControls();
                }}
                className="mono-meta rounded-full bg-white px-4 py-2 text-xs font-bold tracking-widest text-black shadow-lg transition hover:bg-zinc-200"
              >
                {skipChapter.kind === 'intro' ? "Skip Intro" : "Skip Outro"}
              </button>
            </div>
          )}
          <div
            ref={seekWrapRef}
            onPointerMove={handleSeekHoverMove}
            onPointerLeave={handleSeekHoverLeave}
            className="relative mb-3 h-1.5 w-full rounded-full bg-white/20"
          >
            <div ref={bufferedFillRef} className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: "0%" }} />
            <div ref={playedFillRef} className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: "0%" }} />
            <div
              ref={scrubTooltipRef}
              className="pointer-events-none absolute -top-7 hidden rounded bg-black/85 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur"
              style={{ display: "none" }}
              aria-hidden
            />
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
                if (lockedRef.current) {
                  setLockHint(true);
                  if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
                  lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
                  return;
                }
                if (!e.isPrimary) return;
                if (e.pointerType === "mouse" && e.button !== 0) return;
                draggingRef.current = true;
                pendingSeekRef.current = null;
                // fine-scrub baseline
                const wrap = seekWrapRef.current;
                if (wrap) {
                  const rect = wrap.getBoundingClientRect();
                  const dur = absoluteDuration();
                  if (isSeekableDuration(dur)) {
                    const x = e.clientX - rect.left;
                    const clampedX = Math.max(0, Math.min(rect.width, x));
                    const tpos = (clampedX / Math.max(rect.width, 1)) * dur;
                    scrubStartXRef.current = e.clientX;
                    scrubStartYRef.current = e.clientY;
                    scrubGrabTimeRef.current = tpos;
                    scrubModeRef.current = 'normal';
                    // init slider to grab time so commitSeekFromRange lands at preview on quick tap
                    e.currentTarget.value = String(Math.floor(tpos));
                  } else {
                    scrubStartXRef.current = e.clientX;
                    scrubStartYRef.current = e.clientY;
                    scrubGrabTimeRef.current = Number(seekRef.current?.value ?? 0);
                    scrubModeRef.current = 'normal';
                  }
                } else {
                  scrubStartXRef.current = e.clientX;
                  scrubStartYRef.current = e.clientY;
                  scrubGrabTimeRef.current = Number(seekRef.current?.value ?? 0);
                  scrubModeRef.current = 'normal';
                }
                try {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                } catch {}
                pokeControls();
              }}
              onPointerUp={(e) => {
                if (!e.isPrimary) return;
                scrubStartXRef.current = null;
                scrubStartYRef.current = null;
                scrubGrabTimeRef.current = null;
                scrubModeRef.current = 'normal';
                if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {}
                }
                commitSeekFromRange(e.currentTarget);
              }}
              onLostPointerCapture={(e) => {
                if (draggingRef.current) {
                  scrubStartXRef.current = null;
                  scrubStartYRef.current = null;
                  scrubGrabTimeRef.current = null;
                  commitSeekFromRange(e.currentTarget);
                }
              }}
              onPointerLeave={(e) => {
                const tip = scrubTooltipRef.current;
                if (tip) tip.style.display = "none";
                if (draggingRef.current && e.buttons === 0 && e.isPrimary) {
                  scrubStartXRef.current = null;
                  scrubStartYRef.current = null;
                  scrubGrabTimeRef.current = null;
                  commitSeekFromRange(e.currentTarget);
                }
              }}
              onPointerCancel={(e) => {
                if (!e.isPrimary) return;
                draggingRef.current = false;
                scrubStartXRef.current = null;
                scrubStartYRef.current = null;
                scrubGrabTimeRef.current = null;
                scrubModeRef.current = 'normal';
                pendingSeekRef.current = null;
                const tip = scrubTooltipRef.current;
                if (tip) tip.style.display = "none";
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.blur();
              }}
              onChange={(e) => {
                if (lockedRef.current) {
                  setLockHint(true);
                  if (lockHintTimerRef.current != null) window.clearTimeout(lockHintTimerRef.current);
                  lockHintTimerRef.current = window.setTimeout(() => setLockHint(false), 2500);
                  return;
                }
                const target = e.currentTarget;
                const max = Number(target.max || 0);
                const v = Number(target.value);
                if (!isSeekableDuration(max)) return;
                const pct = seekProgressPct(v, max);
                target.style.setProperty("--progress", `${pct}%`);
                if (playedFillRef.current) playedFillRef.current.style.width = `${pct}%`;
                if (timeRef.current) timeRef.current.textContent = timeModeRef.current === 'remaining' ? formatRemaining(v, max) : formatClock(v);
                // during drag, keep grab time in sync with slider value so window move delta stays correct if user twitches via keyboard
                if (draggingRef.current && scrubGrabTimeRef.current != null) {
                  // no-op: window move owns preview when dy present; if drag without window trigger, keep slider value as ground truth
                }
                if (!draggingRef.current) commitSeekFromRange(target);
              }}
            />
            {/* chapter notches — 01§1.7, absolute by start/duration pct, empty=zero notches */}
            {(() => {
              const chaps = (loaded?.streams as { chapters?: Chapter[] })?.chapters;
              const dur = absoluteDuration();
              if (!chaps?.length || !isSeekableDuration(dur)) return null;
              return chaps.map((ch, idx) => {
                const left = chapterLeftPct(ch.start, dur);
                const w = chapterWidthPct(ch.start, ch.end, dur);
                if (w <= 0) return null;
                const isIntroOutro = ch.kind === 'intro' || ch.kind === 'outro';
                return (
                  <button
                    key={`${ch.start}-${idx}-${ch.kind}`}
                    aria-label={ch.label}
                    title={ch.label}
                    onClick={() => {
                      void seekAbsoluteRef.current(ch.start + 0.1);
                      pokeControls();
                    }}
                    className={`absolute top-0 h-full rounded-sm ${isIntroOutro ? "bg-brand" : "bg-white/40"} opacity-80 hover:opacity-100`}
                    style={{ left: `${left}%`, width: `${Math.max(w, 0.6)}%` }}
                  />
                );
              });
            })()}
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={() => {
                const s = loaded?.details.seasons ?? [];
                const prev = prevEpisode(s, season, episode);
                if (!prev) { flashNotice("No previous episode"); return; }
                router.push(`/watch/${provider}/${id}?s=${prev.season}&e=${prev.episode}`);
                pokeControls();
              }}
              aria-label="Previous episode"
              className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/15 disabled:opacity-30"
            >
              <PrevEpIcon width={22} height={22} />
            </button>
            <button
              onClick={() => seekBy(-seekStepRef.current)}
              aria-label={`Back ${seekStep}s`}
              className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/15"
              title={`Back ${seekStep}s`}
            >
              <RewindIcon width={22} height={22} />
            </button>
            <button
              onClick={() => {
                if (endedRef.current && !nextUp) {
                  endedRef.current = false;
                  void seekAbsoluteRef.current(0);
                  void videoRef.current?.play().catch(() => undefined);
                  try {
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
                        position: 0,
                        duration: absoluteDuration(),
                      },
                      authedRef.current,
                      false,
                    );
                  } catch {}
                  pokeControls();
                } else {
                  togglePlay();
                }
              }}
              aria-label={endedRef.current && !nextUp ? "Replay" : state === "playing" ? "Pause" : "Play"}
              className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/15"
            >
              {endedRef.current && !nextUp ? (
                <ReplayIcon width={26} height={26} />
              ) : state === "playing" ? (
                <svg viewBox="0 0 24 24" width={26} height={26} fill="currentColor"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" /></svg>
              ) : (
                <PlayIcon width={26} height={26} className="translate-x-0.5" />
              )}
            </button>
            <button
              onClick={() => seekBy(seekStepRef.current)}
              aria-label={`Forward ${seekStep}s`}
              className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/15"
              title={`Forward ${seekStep}s`}
            >
              <ForwardIcon width={22} height={22} />
            </button>
            <button
              onClick={() => {
                const s = loaded?.details.seasons ?? [];
                const next = nextEpisode(s, season, episode);
                if (!next) { flashNotice("No next episode"); return; }
                router.push(`/watch/${provider}/${id}?s=${next.season}&e=${next.episode}`);
                pokeControls();
              }}
              aria-label="Next episode"
              className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/15 disabled:opacity-30"
            >
              <NextEpIcon width={22} height={22} />
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
            <div ref={volMenuRef} className="relative">
              <button
                onClick={() => {
                  setVolPopoverOpen((o) => !o);
                  pokeControls();
                }}
                aria-label="Volume options"
                aria-expanded={volPopoverOpen}
                className={`grid h-9 w-9 place-items-center rounded-full border transition ${volPopoverOpen || volumeBoost || normalizeOn ? "border-brand bg-brand/15 text-brand" : "border-white/20 bg-white/5 text-zinc-300 hover:bg-white/10"}`}
                title="Volume boost & normalize"
              >
                <BoostIcon width={16} height={16} />
              </button>
              {volPopoverOpen && (
                <div className="glass-panel absolute bottom-full right-0 z-30 mb-2 w-64">
                  <p className="eyebrow px-3 pb-1.5 pt-2.5 text-brand">VOLUME</p>
                  <ul className="max-h-72 overflow-y-auto pb-1">
                    <li className="hairline-t">
                      <button
                        onClick={() => void setVolumeBoostEnabled(!volumeBoost)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${volumeBoost ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="text-xs">Boost to 200%</span>
                        {volumeBoost && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                    <li className="hairline-t">
                      <button
                        onClick={() => void setNormalizeEnabled(!normalizeOn)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${normalizeOn ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="text-xs">Normalize loudness</span>
                        {normalizeOn && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                  </ul>
                </div>
              )}
            </div>
            {/* hidden file input for side-load */}
            <input
              ref={(el) => { fileInputRef.current = el; }}
              type="file"
              accept=".srt,.vtt,.ass,.ssa,.ttml"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleSideLoadFile(f);
                // reset so same file can be re-selected
                try { e.currentTarget.value = ''; } catch {}
              }}
            />
            {/* one-tap CC ON/OFF: only when tracks exist */}
            {supportsSubs !== false && subOptions.length > 0 && (
              <button
                onClick={toggleCcQuick}
                aria-label={chosenSub ? "Captions off" : "Captions on"}
                className={`grid h-9 w-9 place-items-center rounded-full border text-xs font-bold tracking-widest transition ${chosenSub ? "border-brand bg-brand/15 text-brand" : "border-white/20 bg-white/5 text-zinc-300 hover:bg-white/10"}`}
                title={chosenSub ? "Captions ON — click to turn off" : "Captions OFF — click to turn on"}
              >
                <CcIcon width={16} height={16} />
              </button>
            )}
            {/* CC menu: capability-gated — hide when provider declares no support */}
            {supportsSubs !== false && (
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
                  <CcIcon width={18} height={18} />
                </button>
                {subsOpen && (
                  <div className="glass-panel absolute bottom-full right-0 z-30 mb-2 w-72">
                    <p className="eyebrow px-3 pb-1.5 pt-2.5 text-brand">SUBTITLES</p>
                    <ul className="max-h-[min(60vh,28rem)] overflow-y-auto pb-1">
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
                      {subOptions.length === 0 ? (
                        <li className="hairline-t px-3 py-2.5 text-xs text-zinc-500">No subtitles available</li>
                      ) : (
                        subOptions.map((opt) => {
                          const isActive = chosenSub?.url === opt.url;
                          const badges: string[] = [];
                          if (opt.format) badges.push(opt.format.toUpperCase());
                          if (opt.forced) badges.push("FORCED");
                          if (opt.sdh) badges.push("SDH");
                          if (opt.provider) badges.push(opt.provider.toUpperCase());
                          if (opt.source === 'manifest') badges.push("Manifest");
                          if (opt.source === 'local') badges.push("Local");
                          if (opt.source === 'search') badges.push("Search");
                          return (
                            <li key={opt.url + ':' + (opt.language ?? opt.name)} className="hairline-t">
                              <button
                                onClick={() => chooseSubtitle(opt)}
                                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${
                                  isActive ? "text-brand" : "text-zinc-200"
                                }`}
                              >
                                <span className="flex min-w-0 flex-col">
                                  <span className="truncate text-xs">{opt.name}</span>
                                  {badges.length > 0 && (
                                    <span className="mono-meta mt-0.5 flex flex-wrap gap-1 text-[9px] tracking-widest text-zinc-500">
                                      {badges.map((b) => (
                                        <span key={b} className="rounded-[2px] border border-white/15 px-1 py-px">{b}</span>
                                      ))}
                                    </span>
                                  )}
                                </span>
                                {isActive && <CheckIcon width={14} height={14} />}
                              </button>
                            </li>
                          );
                        })
                      )}
                      <li className="hairline-t">
                        <button
                          onClick={() => {
                            fileInputRef.current?.click();
                            setSubsOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
                        >
                          <span>Load subtitle file…</span>
                        </button>
                      </li>
                      <li className="hairline-t">
                        <button
                          onClick={() => {
                            setSearchOpen((o) => !o);
                            pokeControls();
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
                          aria-expanded={searchOpen}
                        >
                          <span>Search subtitles…</span>
                          {searchResults.length > 0 && (
                            <span className="mono-meta rounded-full bg-brand/20 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-brand">{searchResults.length}</span>
                          )}
                        </button>
                      </li>
                      {searchOpen && (
                        <li className="hairline-t px-3 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {(['opensubtitles','subscene','aniskip','jimaku'] as const).map((p) => (
                              <button
                                key={p}
                                onClick={() => setSearchProvider(p)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize tracking-widest transition ${searchProvider===p ? "border-brand bg-brand/15 text-brand" : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"}`}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => void runSubtitleSearch()}
                            disabled={searchLoading}
                            className="mt-2 w-full rounded-md bg-brand px-3 py-2 text-xs font-bold text-white transition hover:bg-brand/90 disabled:opacity-50"
                          >
                            {searchLoading ? "Searching…" : `Search ${searchProvider}`}
                          </button>
                          {searchResults.length > 0 && (
                            <ul className="mt-2 max-h-40 overflow-y-auto rounded-md border border-white/10">
                              {searchResults.map((opt) => {
                                const isActive = chosenSub?.url === opt.url;
                                return (
                                  <li key={"search-"+opt.url} className="hairline-t first:*:border-t-0">
                                    <button
                                      onClick={() => chooseSubtitle(opt)}
                                      className={`flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left transition hover:bg-white/10 ${isActive ? "text-brand" : "text-zinc-200"}`}
                                    >
                                      <span className="truncate text-xs">{opt.name}</span>
                                      <span className="mono-meta shrink-0 rounded-[2px] border border-white/15 px-1 py-px text-[9px] tracking-widest text-zinc-500">{(opt.format ?? opt.provider ?? "Search").toUpperCase()}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      )}
                      {/* Dual toggle + Second subtitle section */}
                      <li className="hairline-t px-3 py-2.5">
                        <label className="flex cursor-pointer items-center justify-between gap-3">
                          <span className="text-xs text-zinc-200">Dual subtitles</span>
                          <input
                            type="checkbox"
                            checked={dualSubs}
                            onChange={(e) => toggleDual(e.target.checked)}
                            className="h-4 w-4 rounded border-white/20 bg-transparent accent-brand"
                          />
                        </label>
                      </li>
                      {dualSubs && (
                        <>
                          <li className="hairline-t">
                            <div className="px-3 pb-1 pt-2.5">
                              <p className="mono-meta text-[10px] font-bold tracking-[0.18em] text-zinc-400">SECOND SUBTITLE</p>
                            </div>
                          </li>
                          <li className="hairline-t">
                            <button
                              onClick={() => chooseSecondSubtitle(null)}
                              className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${!chosenSub2 ? "text-brand" : "text-zinc-300"}`}
                            >
                              <span className="mono-meta text-xs tracking-widest">OFF</span>
                              {!chosenSub2 && <CheckIcon width={14} height={14} />}
                            </button>
                          </li>
                          {subOptions.map((opt) => {
                            const isActive2 = chosenSub2?.url === opt.url;
                            const isPrimary = chosenSub?.url === opt.url;
                            if (isPrimary) return null;
                            const badges2: string[] = [];
                            if (opt.format) badges2.push(opt.format.toUpperCase());
                            if (opt.forced) badges2.push("FORCED");
                            if (opt.sdh) badges2.push("SDH");
                            return (
                              <li key={"dual-"+opt.url + ':' + (opt.language ?? opt.name)} className="hairline-t">
                                <button
                                  onClick={() => chooseSecondSubtitle(opt)}
                                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${isActive2 ? "text-brand" : "text-zinc-200"}`}
                                >
                                  <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-xs">{opt.name}</span>
                                    {badges2.length>0 && (
                                      <span className="mono-meta mt-0.5 flex flex-wrap gap-1 text-[9px] tracking-widest text-zinc-500">
                                        {badges2.map((b)=>(<span key={b} className="rounded-[2px] border border-white/15 px-1 py-px">{b}</span>))}
                                      </span>
                                    )}
                                  </span>
                                  {isActive2 && <CheckIcon width={14} height={14} />}
                                </button>
                              </li>
                            );
                          })}
                        </>
                      )}
                      {/* Sync offset slider(s) */}
                      <li className="hairline-t px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-300">Sync primary</span>
                          <span className="mono-meta text-xs font-bold text-brand">{subOffsetMs>0?'+':''}{subOffsetMs}ms</span>
                        </div>
                        <input
                          type="range"
                          min={-2000}
                          max={2000}
                          step={50}
                          value={subOffsetMs}
                          onChange={(e) => {
                            const v = clampOffset(Number(e.target.value));
                            subOffsetMsRef.current=v; setSubOffsetMs(v);
                            // live preview for overlay
                            if (primaryCues.length>0 || secondaryCues.length>0) {
                              overlayNowRef.current = videoRef.current?.currentTime ?? overlayNow;
                              setOverlayNow(overlayNowRef.current);
                            }
                          }}
                          onPointerUp={(e) => {
                            const v = clampOffset(Number((e.target as HTMLInputElement).value));
                            persistOffset('subOffsetMs', v);
                            const need = needsOverlay(chosenSubRef.current?.format ?? null, chosenSub2Ref.current?.format ?? null, dualSubsRef2.current && !!chosenSub2Ref.current, (subFilterRef.current ?? 'all') !== 'all' ? 'signs':'all');
                            const videoEl = videoRef.current;
                            if (!need && subTrackRef.current && videoEl && chosenSubRef.current) {
                              const cues = subTrackRef.current.cues ? [...subTrackRef.current.cues] : [...primaryCuesRef.current];
                              if (cues.length) {
                                    subTrackRef.current.cleanup();
                                const state = attachSubtitleTrack(videoEl, chosenSubRef.current.name, cues,{offsetMs: v, source:'native'});
                                subTrackRef.current=state;
                              }
                            }
                            const sign = v>0?'+':''; flashNotice(`Subs ${sign}${v}ms`);
                          }}
                          className="mt-2 w-full accent-brand"
                          aria-label="Subtitle sync offset"
                        />
                        <div className="mt-1 flex justify-between text-[10px] text-zinc-500"><span>-2000ms</span><span>+2000ms</span></div>
                      </li>
                      {dualSubs && chosenSub2 && (
                        <li className="hairline-t px-3 py-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-zinc-300">Sync secondary</span>
                            <span className="mono-meta text-xs font-bold text-brand">{subOffsetMs2>0?'+':''}{subOffsetMs2}ms</span>
                          </div>
                          <input
                            type="range"
                            min={-2000}
                            max={2000}
                            step={50}
                            value={subOffsetMs2}
                            onChange={(e) => {
                              const v=clampOffset(Number(e.target.value));
                              subOffsetMs2Ref.current=v; setSubOffsetMs2(v);
                              overlayNowRef.current = videoRef.current?.currentTime ?? overlayNow;
                              setOverlayNow(overlayNowRef.current);
                            }}
                            onPointerUp={(e)=>{ const v=clampOffset(Number((e.target as HTMLInputElement).value)); persistOffset('subOffsetMs2',v); const sign=v>0?'+':''; flashNotice(`Subs2 ${sign}${v}ms`); }}
                            className="mt-2 w-full accent-brand"
                            aria-label="Secondary subtitle sync offset"
                          />
                        </li>
                      )}
                      {/* Style section */}
                      <li className="hairline-t px-3 pb-1 pt-2.5">
                        <p className="eyebrow !text-brand text-[10px]">STYLE</p>
                      </li>
                      <li className="hairline-t px-3 py-2.5">
                        <span className="text-xs text-zinc-300">Font</span>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(['sans','serif','mono','anime'] as const).map((f) => (
                            <button
                              key={f}
                              onClick={()=> updateSubStyle({ font: f })}
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize tracking-widest transition ${subStyle.font===f ? "border-brand bg-brand/15 text-brand" : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"}`}
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      </li>
                      <li className="hairline-t px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-300">Scale</span>
                          <span className="mono-meta text-xs font-bold text-brand">{Math.round(subStyle.scale*100)}%</span>
                        </div>
                        <input type="range" min={0.5} max={2} step={0.05} value={subStyle.scale} onChange={(e)=> updateSubStyle({ scale: Number(e.target.value)})} className="mt-2 w-full accent-brand" aria-label="Subtitle scale" />
                        <div className="mt-1 flex justify-between text-[10px] text-zinc-500"><span>50%</span><span>200%</span></div>
                      </li>
                      <li className="hairline-t px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-300">Text color</span>
                          <span className="text-[11px] text-zinc-500">{subStyle.color}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {['#ffffff','#ffff00','#00ffff','#ffcc00','#ff5a5a','#a0ff6b','#111111'].map((c)=> (
                            <button key={c} aria-label={`Pick color ${c}`} onClick={()=> updateSubStyle({ color: c })} className={`h-7 w-7 rounded-full border-2 transition ${subStyle.color.toLowerCase()===c.toLowerCase() ? "border-brand scale-110" : "border-white/15 hover:border-white/30"}`} style={{ background:c }} />
                          ))}
                        </div>
                      </li>
                      <li className="hairline-t px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-300">Background opacity</span>
                          <span className="mono-meta text-xs font-bold text-brand">{Math.round(subStyle.bgOpacity*100)}%</span>
                        </div>
                        <input type="range" min={0} max={1} step={0.05} value={subStyle.bgOpacity} onChange={(e)=> updateSubStyle({ bgOpacity: Number(e.target.value)})} className="mt-2 w-full accent-brand" aria-label="Background opacity" />
                      </li>
                      <li className="hairline-t px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-300">Y-offset</span>
                          <span className="mono-meta text-xs font-bold text-brand">{subStyle.yOffset>0?'+':''}{subStyle.yOffset}%</span>
                        </div>
                        <input type="range" min={-20} max={20} step={1} value={subStyle.yOffset} onChange={(e)=> updateSubStyle({ yOffset: Number(e.target.value)})} className="mt-2 w-full accent-brand" aria-label="Subtitle Y offset" />
                        <div className="mt-1 flex justify-between text-[10px] text-zinc-500"><span>-20%</span><span>+20%</span></div>
                      </li>
                      <li className="hairline-t px-3 py-2.5">
                        <span className="text-xs text-zinc-300">Stroke color</span>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {['#000000','#ffffff','#ff00ff','#00ffff','#ffff00','#333333'].map((c)=> (
                            <button key={'stroke-'+c} aria-label={`Pick stroke ${c}`} onClick={()=> updateSubStyle({ stroke: c })} className={`h-7 w-7 rounded-full border-2 transition ${subStyle.stroke.toLowerCase()===c.toLowerCase() ? "border-brand scale-110" : "border-white/15 hover:border-white/30"}`} style={{ background:c }} />
                          ))}
                        </div>
                      </li>
                      <li className="hairline-t px-3 py-2.5">
                        <span className="text-xs text-zinc-300">Weight</span>
                        <div className="mt-2 flex gap-1.5">
                          {(['normal','bold'] as const).map((w)=> (
                            <button key={w} onClick={()=> updateSubStyle({ weight: w })} className={`flex-1 rounded-full border px-2.5 py-1.5 text-xs font-bold capitalize tracking-widest transition ${subStyle.weight===w ? "border-brand bg-brand/15 text-brand" : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"}`}>{w}</button>
                          ))}
                        </div>
                      </li>
                      {/* Signs-only filter (P4): classifyCue kinds dialogue vs sign/song */}
                      <li className="hairline-t px-3 py-2.5">
                        <label className="flex cursor-pointer items-center justify-between gap-3">
                          <span className="text-xs text-zinc-200">Signs / lyrics only</span>
                          <input
                            type="checkbox"
                            checked={subFilter === 'signs'}
                            onChange={(e) => toggleSubFilter(e.target.checked ? 'signs' : 'all')}
                            className="h-4 w-4 rounded border-white/20 bg-transparent accent-brand"
                          />
                        </label>
                        <p className="mono-meta mt-1 text-[10px] tracking-widest text-zinc-500">Hides dialogue, shows signs & songs</p>
                      </li>
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div ref={speedMenuRef} className="relative">
              <button
                onClick={() => {
                  setSpeedOpen((o) => !o);
                  pokeControls();
                }}
                aria-label="Playback speed"
                aria-expanded={speedOpen}
                className={`mono-meta h-8 border px-2.5 text-xs font-bold tracking-[0.15em] transition ${speedOpen || playbackRate !== 1 ? "border-brand bg-brand/15 text-brand" : "border-white/25 bg-white/5 text-zinc-200 hover:bg-white/10"}`}
              >
                {playbackRate.toFixed(2).replace(/\.?0+$/, "")}×
              </button>
              {speedOpen && (
                <div className="glass-panel absolute bottom-full right-0 z-30 mb-2 w-64">
                  <p className="eyebrow px-3 pb-1.5 pt-2.5 text-brand">SPEED</p>
                  <ul className="max-h-72 overflow-y-auto pb-1">
                    {SPEED_PRESETS.map((preset) => {
                      const isActive = nearestPreset(playbackRate) === preset;
                      return (
                        <li key={preset} className="hairline-t">
                          <button
                            onClick={() => setRate(preset)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${isActive ? "text-brand" : "text-zinc-200"}`}
                          >
                            <span className="text-xs">{preset}×</span>
                            {isActive && <CheckIcon width={14} height={14} />}
                          </button>
                        </li>
                      );
                    })}
                    {playbackRate !== nearestPreset(playbackRate) && (
                      <li className="hairline-t">
                        <button
                          onClick={() => setRate(playbackRate)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-brand transition hover:bg-white/10"
                        >
                          <span className="text-xs">Custom {playbackRate.toFixed(2).replace(/\.?0+$/, "")}×</span>
                          <CheckIcon width={14} height={14} />
                        </button>
                      </li>
                    )}
                    <li className="hairline-t px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-300">Custom</span>
                        <span className="mono-meta text-xs font-bold text-brand">{playbackRate.toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0.25}
                        max={3.0}
                        step={0.05}
                        value={playbackRate}
                        onChange={(e) => setRate(Number(e.target.value))}
                        className="mt-2 w-full accent-brand"
                        aria-label="Playback speed"
                      />
                    </li>
                    <li className="hairline-t">
                      <button
                        onClick={togglePitchLock}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${pitchLock ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="text-xs">Pitch lock</span>
                        {pitchLock && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                    <li className="hairline-t">
                      <button
                        onClick={() => void toggleSmartSpeed(!smartSpeed)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${smartSpeed ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="flex flex-col">
                          <span className="text-xs">Smart speed</span>
                          <span className="mono-meta text-[10px] tracking-widest text-zinc-500">Silence → 1.8× (resumes on speech)</span>
                        </span>
                        {smartSpeed && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                  </ul>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                const nextMode: TimeMode = timeModeRef.current === 'elapsed' ? 'remaining' : 'elapsed';
                setTimeModeState(nextMode);
                timeModeRef.current = nextMode;
                try { setPrefs({ timeMode: nextMode }); } catch {}
                pokeControls();
              }}
              aria-label="Toggle remaining time"
              className="ml-1 rounded px-1 text-sm tabular-nums text-zinc-300 transition hover:bg-white/10 hover:text-white"
              title="Toggle remaining time"
            >
              <span ref={timeRef}>0:00</span>
              <span className="mx-1 text-zinc-600">/</span>
              <span ref={durationRef} data-d="-1">–:––</span>
            </button>

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

            <div ref={aspectMenuRef} className="relative">
              <button
                onClick={() => {
                  setAspectOpen((o) => !o);
                  pokeControls();
                }}
                aria-label="Aspect ratio"
                aria-expanded={aspectOpen}
                className={`grid h-9 w-9 place-items-center rounded-full border transition ${aspectOpen ? "border-brand bg-brand/15 text-brand" : "border-white/20 bg-white/5 text-zinc-300 hover:bg-white/10"}`}
                title="Aspect: Fit / Fill / Stretch"
              >
                <AspectIcon width={16} height={16} />
              </button>
              {aspectOpen && (
                <div className="glass-panel absolute bottom-full right-0 z-30 mb-2 w-64">
                  <p className="eyebrow px-3 pb-1.5 pt-2.5 text-brand">ASPECT</p>
                  <ul className="pb-1">
                    <li className="hairline-t">
                      <button
                        onClick={() => {
                          applyAspect("contain");
                          setAspectOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${aspectModeState === "contain" ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="text-xs">Fit</span>
                        {aspectModeState === "contain" && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                    <li className="hairline-t">
                      <button
                        onClick={() => {
                          applyAspect("cover");
                          setAspectOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${aspectModeState === "cover" ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="text-xs">Fill</span>
                        {aspectModeState === "cover" && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                    <li className="hairline-t">
                      <button
                        onClick={() => {
                          applyAspect("fill");
                          setAspectOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${aspectModeState === "fill" ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="text-xs">Stretch</span>
                        {aspectModeState === "fill" && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                  </ul>
                </div>
              )}
            </div>
            <div ref={filterMenuRef} className="relative">
              <button
                onClick={() => {
                  setFilterOpen((o) => !o);
                  pokeControls();
                }}
                aria-label="Video filters"
                aria-expanded={filterOpen}
                className={`grid h-9 w-9 place-items-center rounded-full border transition ${filterOpen || filterMode !== "none" || nightDim > 0 ? "border-brand bg-brand/15 text-brand" : "border-white/20 bg-white/5 text-zinc-300 hover:bg-white/10"}`}
                title="Filters & dimmer"
              >
                <GearIcon width={16} height={16} />
              </button>
              {filterOpen && (
                <div className="glass-panel absolute bottom-full right-0 z-30 mb-2 w-64">
                  <p className="eyebrow px-3 pb-1.5 pt-2.5 text-brand">FILTERS</p>
                  <ul className="pb-1">
                    <li className="hairline-t">
                      <button
                        onClick={() => applyFilter("none")}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${filterMode === "none" ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="text-xs">None</span>
                        {filterMode === "none" && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                    <li className="hairline-t">
                      <button
                        onClick={() => applyFilter("anime")}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${filterMode === "anime" ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="text-xs">Anime pop</span>
                        {filterMode === "anime" && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                    <li className="hairline-t">
                      <button
                        onClick={() => applyFilter("contrast")}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/10 ${filterMode === "contrast" ? "text-brand" : "text-zinc-200"}`}
                      >
                        <span className="text-xs">High contrast</span>
                        {filterMode === "contrast" && <CheckIcon width={14} height={14} />}
                      </button>
                    </li>
                    <li className="hairline-t px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-300">Dimmer</span>
                        <span className="mono-meta text-xs font-bold text-brand">{Math.round(nightDim * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={nightDim}
                        onChange={(e) => setNightDim(Number(e.target.value))}
                        className="mt-2 w-full accent-brand"
                        aria-label="Night dimmer"
                      />
                    </li>
                  </ul>
                </div>
              )}
            </div>
            <button
              onClick={() => void togglePip()}
              aria-label={pipActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}
              className={`grid h-9 w-9 place-items-center rounded-full border transition ${pipActive ? "border-brand bg-brand/15 text-brand" : "border-white/20 bg-white/5 text-zinc-300 hover:bg-white/10"}`}
              title="Picture-in-Picture"
            >
              <PipIcon width={16} height={16} />
            </button>
            {canAirPlay ? (
              <button
                onClick={showAirPlay}
                aria-label="AirPlay"
                className="grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-white/5 text-zinc-300 transition hover:bg-white/10"
                title="AirPlay"
              >
                <CastIcon width={16} height={16} />
              </button>
            ) : null}
            <button
              onClick={() => {
                const next = !statsOpen;
                setStatsOpen(next);
                try {
                  setPrefs({ statsOpen: next });
                } catch {}
                if (next) {
                  const v = videoRef.current;
                  if (v) {
                    const snap = sampleStats(v, hlsRef.current ?? null, dashRef.current ?? null);
                    statsSnapshotRef.current = snap;
                    setStatsTick((x) => x + 1);
                  }
                }
                pokeControls();
              }}
              aria-label="Stats for nerds"
              aria-pressed={statsOpen}
              className={`grid h-9 w-9 place-items-center rounded-full border transition ${statsOpen ? "border-brand bg-brand/15 text-brand" : "border-white/20 bg-white/5 text-zinc-300 hover:bg-white/10"}`}
              title="Stats for nerds"
            >
              <StatsIcon width={16} height={16} />
            </button>
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
