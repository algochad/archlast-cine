# 04 — Audio, Episode Nav, Display & System

Spec §1: Audio/Volume/Sub overlays (player side), Episode Navigation, Display/System/Technical overlays.
Files: `src/components/watch-player.tsx`, `icons.tsx`, `src/hooks/*`, `src/lib/player-prefs.ts`, `globals.css`.

## RF-1 Shared refactor (do first, all overlays use it)

1. Extract `useDismissable` from `nav.tsx:24` (module-private) → `src/hooks/use-dismissable.ts` (exported). Migrate subs menu (`:1365-1373`) + all new popovers to it. Delete no behavior.
2. `icons.tsx` additions (all `base(p)` stroke): `RewindIcon`, `ForwardIcon`, `ReplayIcon`, `StepBackIcon`, `StepFwdIcon`, `LockIcon`, `UnlockIcon`, `PipIcon`, `CastIcon`, `StatsIcon`, `AspectIcon`, `PrevEpIcon`, `NextEpIcon`, `BoostIcon` (volume), `GearIcon` (settings). Wire unused `CcIcon` into CC button (replace text glyph `:2046`).
3. Escape cascade (`:1407-1414`) order: `subs → speed → audio → episode → stats → settings → fullscreen → nextUp → resumeAsk → back`. Lock intercepts entire keyboard handler + gesture layer.

## 4.1 Volume: slider + mute + boost/normalization

- Existing: mute toggle (`:1092-1101`), native range `w-20 accent-brand` (`:2021-2029`).
- Tasks:
  1. Volume popover (optional; keep inline slider, add boost row): `AudioContext` gain chain? `createMediaElementSource` + `GainNode` + `DynamicsCompressor` for normalize; "Boost" = gain up to 2.0 (200%). Prefs: `volumeBoost: boolean`, `normalize: boolean`.
  2. Risk: creating `MediaElementSource` reroutes audio through WebAudio permanently; must init once, lazily on first boost enable. If never enabled, zero graph (no perf cost).
  3. Quick-mute `M` key + button stay direct (`video.muted`); boost composes (gain after mute? mute is element-level, gain post — boost of muted = silent, correct).
  4. Persist `volume`, `muted`, `volumeBoost`, `normalize` (local; volume cross-device optional).
- Acceptance: dialogue/action loudness evens with normalize on; boost to 200% without clip (compressor); no crash when toggled mid-transcode.

## 4.2 Audio track switcher (dubs/AD)

- Baseline: `Dub { subject_id, language, label }` (`types.ts:40`) declared, never consumed. `Release` has single audio (`-map 0:a:0` backend). HLS/DASH multi-audio uninspected.
- Tasks:
  1. P1: render track list IF data exists — probe `video.audioTracks` (Chrome) + HLS `AUDIO` groups via `hlsRef.current?.audioTracks` + DASH `dashRef.getTracksFor('audio')`. Popover lists tracks, click switches (`hls.audioTrack = i`, `dash.setCurrentTrack`). If exactly 0/1 tracks, hide button (no dead UI).
  2. P4: backend multi-audio (`-map 0:a` + `-var_stream_map`, see 08) + `Dub` wiring into player (prefer `details.dubs` labels).
- Acceptance: multi-audio HLS shows switcher; single-audio hides it.

## 4.3 Quick subtitle toggle + dual (player side; engine in 05/06)

- Tasks: one-tap CC ON/OFF button on primary bar (currently menu-only `:2033`). Toggles `chosenSub` null↔last. Dual-sub stage: second `SubtitleTrackState` (see 06) — player reserves `dualSubRef` + top/bottom slots now, renders later.

## 4.4 Episode selector drawer + prev/next + skip prompts + autoplay

- Existing: `maybeNextEpisode` (`:1310-1330`) walks `details.seasons`; next-up card 10s auto-push (`:1346-1362`) with NO opt-out.
- Tasks:
  1. Drawer: right-side panel (fullscreen-safe, inside container, `glass-panel`, season tabs + episode grid, current highlighted, click → `router.push(/watch/...?s=&e=)`). Data: `loaded.details.seasons` (already loaded). Prev/next buttons in control row (`PrevEpIcon/NextEpIcon`): prev → same-season `episode-1` or prev season last; next → `maybeNextEpisode()`. Disabled at bounds with `flashNotice`.
  2. Skip prompts: buttons "Skip Intro" / "Skip Outro" appear when `absolutePosition()` inside a chapter of kind intro/outro (data from 01.7; without data, hidden). Click → `seekAbsoluteRef.current(chapter.end)`. Auto-show 5s, then fade; `flashNotice("Intro skipped")`.
  3. Autoplay: prefs `autoplay: boolean` default true + countdown seconds `autoplayDelay` default 10. Next-up card gains "Play Now / Cancel" (exists `:1906-1918`) + "Don't autoplay" checkbox writing pref. When off: card shows without countdown (static Play/Cancel).
  4. Escape closes drawer (insert in cascade); drawer button in top bar (list icon) + control row.
- Tests: `maybeNextEpisode` already implicitly covered? Add `episode-nav.test.ts` pure helpers (`prevEpisode(seasons,s,e)`, `nextEpisode(...)`) new file.

## 4.5 Screen lock / child lock

- Tasks:
  1. `lockedRef` + `locked` state; lock button (top bar). When locked: overlay (tap 3× or hold lock icon 1s to unlock — discoverable hint), all controls/gestures/keyboard short-circuit except unlock + back.
  2. Implementation: early-return in `togglePlay`, `seekBy`, gesture hook, keyboard handler; CSS `pointer-events` on control layers stays but handlers guard (keeps transitions working).

## 4.6 Orientation & aspect selector

- Tasks: popover with Fit (contain) / Fill (cover) / Stretch (fill + `object-fit: fill`) / 16:9-crop; `video.style.objectFit`. `screen.orientation.lock('landscape')` attempt on fullscreen (catch — iOS rejects). Pref `aspectMode`. Pinch (02.5) writes same pref.

## 4.7 Filters & night mode

- Tasks: `video.style.filter` presets (None / Anime pop `saturate(1.25) contrast(1.05)` / High contrast / Grayscale?) + dimmer overlay div (same mechanism as brightness 02.3 — unify: `dimmerRef` opacity). Prefs `filter`, `nightDim`. Cheap CSS-only, P1.

## 4.8 PiP & background audio

- Tasks:
  1. PiP button → `video.requestPictureInPicture()` (guard support + transcode window OK — element-level). `disablePictureInPicture` false. Handle `leavepictureinpicture` → `pokeControls`.
  2. Background audio: Media Session + `audio` keeps playing when tab hidden (default unless paused on `visibilitychange` — we never pause, so just don't add one; document). Screen-off mobile = OS-handled via Media Session metadata (extend in 03).
  3. Constraint: `watch-sync.ts` singleton — PiP is same element (no second instance), safe. True background-play with element swap NOT in scope.
- Acceptance: PiP toggles on Chrome desktop + Android; controls usable underneath.

## 4.9 Casting (Chromecast / AirPlay / DLNA)

- Reality: Chromecast needs Cast SDK sender (`cast.framework`) + receiver app; AirPlay uses `video.webkitShowPlaybackTargetPicker` (Safari); DLNA needs server-side renderer discovery (Rust, out of scope P1).
- Phased: P4 — AirPlay button (3 lines, Safari-only, progressive enhancement) + Chromecast basic (`chrome.cast` load, custom receiver pointing at same `play_url`? ticket auth breaks cross-device — receiver can't mint headers; requires backend public-URL mode, see 08). DLNA: backend `POST /api/cast/discover` future.
- P1: AirPlay only (hidden unless `webkitShowPlaybackTargetPicker` exists). Chromecast row stub? NO stubs — omit until backend ready.

## 4.10 Resolution switcher + stats overlay

- Existing: per-release quality chips (`:2090-2118`) calling destructive `startSource`. Keep for source-level; add in-manifest ladder switching (P3, see 07): `hls.currentLevel` / `dash.setQualityFor` without teardown.
- Stats ("Stats for Nerds"): overlay div (mono, top-left under title): FPS (`requestVideoFrameCallback` delta), bitrate (`hls.levels[level].bitrate` / `dash.getAverageThroughput`), codec (`sniffManifest` families), buffer (`video.buffered.end - currentTime`), dropped frames (`video.getVideoPlaybackQuality().droppedVideoFrames`), resolution (`videoWidth×videoHeight`). Poll 1s. Pref `statsOpen`. Cheap, P1/P3.
- Tasks: `src/lib/stats.ts` pure samplers + `StatsOverlay.tsx` component.

## Files touched

- `src/components/watch-player.tsx` (all overlays, drawer, lock, PiP, aspect, filters, stats, autoplay)
- `src/components/StatsOverlay.tsx` (new), `src/hooks/use-dismissable.ts` (new), `src/hooks/use-gestures.ts` (02)
- `src/components/icons.tsx` (14 icons), `src/lib/episode-nav.ts` (new pure + tests)
- `src/lib/player-prefs.ts` (autoplay, aspectMode, filter, volumeBoost, statsOpen, lastCC)
