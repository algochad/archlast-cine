# 01 — Controls & Timeline

Spec §1: Primary Playback & Time Controls. Files: `src/components/watch-player.tsx`, `src/components/icons.tsx`, `src/lib/seek.ts`, `src/lib/format.ts`, `src/app/globals.css`, `src/lib/player-prefs.ts` (new).

## 1.1 Existing (reuse, don't rebuild)

- Container `fixed inset-0 z-40 bg-black` (`watch-player.tsx:1723`); `pokeControls` 3200ms hide-when-playing (`:1026-1040`); body lock (`:946-952`).
- Seek bar: invisible range overlay + `playedFillRef`/`bufferedFillRef` + 5 imperative refs, rAF-owned (`:1437-1494`, `draggingRef` gate `:1466`, pin `:152-181`, watchdog 8s, grace 1.5s).
- `commitSeekFromRange → seekAbsoluteRef.current(value)` (`:1712`). **Every new seek affordance routes through `seekAbsoluteRef`.**
- Button row (`:2010-2125`), `flashNotice` + `seekNotice` band (`:182`, `:1831`), CC popover pattern (`:2049-2080`), `state/buffering`, `maybeNextEpisode` (`:1310`).

## 1.2 Play / Pause / Replay

- Problem: `onEnded` → nextUp or `paused` (`:1544-1556`); natural-end synth for transcode (`:1452-1462`). No replay affordance.
- Tasks:
  1. `icons.tsx`: add `ReplayIcon` (circular arrow, `base(p)` stroke convention).
  2. Center button (`:1834-1845`): when `endedRef.current && !nextUp`, render Replay (aria-label "Replay"), click → `seekAbsoluteRef.current(0)` + `video.play()`. Keep paused-center-play for mid-title pause.
  3. Control-bar toggle (`:2011-2017`): derive icon from `endedRef` — replay glyph at end, else play/pause from `state`.
  4. Respect completion rule: replay re-saves progress (currently `removeWatch` at end deletes local+server rows — replay must `recordWatch` fresh; both `0.98` copies move together, see 09).
- Tests: extend `src/components/__tests__/seek-routing.test.ts` (ended→replay dispatch through seekAbsolute, no direct `currentTime`).

## 1.3 Forward / Backward seek buttons + configurable interval

- Problem: keyboard hardcodes `seekBy(∓10)` (`:1387/:1391`); no on-screen buttons; `seek.ts` has no step constant.
- Tasks:
  1. `src/lib/seek.ts`: add `export const SEEK_STEPS = [5,10,15,30,60] as const; export type SeekStep = typeof SEEK_STEPS[number];` + `resolveSeekStep(pref: unknown): SeekStep` (coerce-invalid→10).
  2. `src/lib/player-prefs.ts` (new, see 09): `seekStep: SeekStep` default 10, local first.
  3. `icons.tsx`: `RewindIcon`, `ForwardIcon` (10-s style circular arrows; badge number optional via `<text>`? keep glyph-only, label carries interval in aria).
  4. Button row: insert `[-X]` before play, `[+X]` after (aria-labels `Back {X}s` / `Forward {X}s`), `onClick → seekBy(∓step)`; `seekBy` (`:1050-1090`) already handles direct + transcode-defer paths — no change except reading pref.
  5. Keyboard `ArrowLeft/Right` use same pref step (replace literals).
  6. Settings surface (account page or player gear — see 09): radio 5/10/15/30/60.
- Tests: `seek.test.ts` — `resolveSeekStep` boundary (garbage→10); component contract test: button dispatch equals pref step.

## 1.4 Timestamp display toggle (current/total vs remaining)

- Problem: `timeRef / durationRef` spans (`:2083-2086`) always `current / total`.
- Tasks:
  1. Prefs: `timeMode: 'elapsed' | 'remaining'` default `'elapsed'`.
  2. Click on timestamp toggles mode (button wrapper, aria-label "Toggle remaining time"); rAF loop writes `remaining = duration - displayTime` prefixed `-` when mode=remaining. Total stays.
  3. Persist in prefs (local; account subset later).
- Tests: pure `formatRemaining(display, duration)` in `format.ts` + test (`format.test.ts`).

## 1.5 Frame preview / thumbnail seeking

- Problem: zero hover handlers on seek input (`onChange` preview only); no sprite endpoint; transcode window breaks `video.duration` assumptions.
- Phased:
  - **P1 (no backend):** hover tooltip with timecode only. `onPointerMove` on seek container → compute `t = (x/width)*duration` via `absoluteDuration()` → position floating label (`formatClock(t)`). Hide on leave. Must honor `draggingRef` gate — writes same refs pattern (separate tooltip node, never fight rAF).
  - **P4 (backend):** sprite sheet + VTT. Requires 08-backend tasks: ffmpeg sprite pass, `valid_transcode_filename` whitelist extend, `/transcode/{s}/sprites` route, `api.ts` client + `types.ts`. Then tooltip swaps timecode → `<img>` sprite offset lookup.
- Tasks P1: tooltip div (absolute above bar, `mono-meta`), pointer handlers on wrapper (not input, to avoid capture conflicts), `absoluteDuration()` source (transcode-safe).
- Acceptance: hover shows correct `formatClock` at 0/25/50/75/100% on direct + transcode paths; no rAF fight (thumb stable while hovering).

## 1.6 Fine-scrubbing mode (vertical pull-down 0.5×/0.1×)

- Constraint: `.player-range { touch-action: pan-y }` (`globals.css:154`) lets vertical escape — need separate capture layer.
- Design: while dragging (`draggingRef`), track vertical offset from drag start; beyond 40px → 0.5× sensitivity, beyond 100px → 0.1×. Sensitivity scales horizontal delta: `preview = grabTime + dx*ratio*sensitivity`.
- Tasks:
  1. New transparent gesture layer above video (below controls z) with `touch-action: none`, only active during scrub drag; or attach `pointermove` on window during drag (simpler, no layout change — preferred).
  2. `seek.ts`: `applyScrubSensitivity(dxPx, pxPerSec, dyPx): { previewTime, mode: 'normal'|'fine'|'ultra' }` pure + tests.
  3. HUD via `flashNotice("Fine scrub 0.5×")` on threshold cross; release commits through `commitSeekFromRange` path (absolute seconds).
- Acceptance: horizontal-only drag unchanged; pull-down visibly slows thumb; commit lands at previewed time.

## 1.7 Chapter & marker overlays

- Problem: no marker data (`Release`/`MediaDetails`/`AnimeDetailsBlock` have no chapters; no API endpoint). Backend work required (see 08).
- P1 static fallback (no backend): derive pseudo-chapters? NO — spec says Intro/OP/Canon/Outro/ED/Post-credits. Without data, render nothing; ship notch *renderer* behind empty data.
- Tasks:
  1. `types.ts`: `export interface Chapter { start: number; end: number; kind: 'intro'|'content'|'outro'|'credits'|'preview'; label: string }` + `StreamsResponse.chapters?: Chapter[]` (optional, additive).
  2. `api.ts`: no change (rides `streams` response).
  3. Renderer: absolute-positioned notch divs inside seek container (`left: start/duration*100%`, `width: span%`), kind-colored (brand for intro/outro, white/40 content edge), `title={label}` tooltip. Guard `isSeekableDuration`.
  4. Click notch → `seekAbsoluteRef.current(chapter.start + 0.1)`.
  5. Skip prompts (Intro/ED buttons) live here too but owned by 04-episode file — cross-link.
- Acceptance: empty chapters → zero notches, no layout shift; fixture chapters render at correct %; click seeks.

## Files touched

- `src/components/watch-player.tsx` (center button, control row, tooltip, notches, keyboard step)
- `src/components/icons.tsx` (Replay, Rewind, Forward)
- `src/lib/seek.ts` (SEEK_STEPS, resolveSeekStep, applyScrubSensitivity)
- `src/lib/format.ts` (formatRemaining)
- `src/lib/player-prefs.ts` (new: seekStep, timeMode)
- `src/lib/types.ts` (Chapter, StreamsResponse.chapters?)
- `src/app/globals.css` (tooltip, notch styles; NO change to `.player-range` touch-action)
