# 03 — Speed & Frame Precision

Spec §1: Speed & Frame Precision Controls. Files: `src/components/watch-player.tsx`, `src/components/icons.tsx`, `src/lib/playback-rate.ts` (new), `src/lib/player-prefs.ts`.

## 0. Baseline

- `playbackRate` never referenced in `src` (grep: zero hits). `preservesPitch` untouched. No speed UI, no frame step.
- Media Session (`setupMediaSession :283-302`) handles play/pause/seekto only — add `playbackrate`/`positionState` here.

## 3.1 Granular speed switcher (presets)

- Presets: 0.25 / 0.5 / 0.75 / 1.0 / 1.25 / 1.5 / 1.75 / 2.0.
- Tasks:
  1. `src/lib/playback-rate.ts` (new): `export const SPEED_PRESETS = [0.25,0.5,0.75,1,1.25,1.5,1.75,2] as const;` `clampRate(r)`, `nearestPreset(r)`. Pure + tests.
  2. `icons.tsx`: `SpeedIcon` (gauge) or text `1×` button — use text badge (matches CC text-button precedent `:2040-2047`), no icon needed. Show current rate `1.25×`.
  3. Speed popover (reuse CC popover pattern `glass-panel absolute bottom-full right-0 w-64` + `eyebrow` + `hairline-t` + `CheckIcon`): preset list, active = `nearestPreset(video.playbackRate)`. Open pairs with `pokeControls()`.
  4. Apply: `video.playbackRate = r; video.preservesPitch = pitchLock (default true);` persist `playbackRate` pref; restore on `boot`/`startSource` (set after `playHls`/dash init — rate resets on `load()`).
  5. Outside-dismiss: reuse extracted `useDismissable` (see 04/RF-1); Escape cascade insert after subs.
- Acceptance: preset survives source switch (quality change) + transcode restart; badge shows rate.

## 3.2 Custom speed slider (0.05/0.1 steps, e.g. 1.15×)

- Tasks:
  1. Same popover: slider `min 0.25 max 3.0 step 0.05` + numeric readout; `onChange` live-sets `playbackRate` (no commit needed — idempotent).
  2. `clampRate` guards; slider + presets stay in sync (slider moves → active preset = nearest; custom value shows "Custom" row checked).
  3. Persist on change (debounced 500ms to prefs).
- Tests: `clampRate` boundaries in `playback-rate.test.ts`.

## 3.3 Pitch correction (audio pitch lock)

- Tasks:
  1. Prefs: `pitchLock: boolean` default true.
  2. Apply everywhere rate is set: `video.preservesPitch = pitchLock` (Chrome/FF; Safari uses `webkitPreservesPitch` — feature-detect both).
  3. Toggle row in speed popover ("Pitch lock", checkmark).
- Acceptance: voices natural at 1.5× with lock on; chipmunk with lock off (manual QA).

## 3.4 Smart speed / silence skip

- Reality check: true silence-skip needs audio analysis (WebAudio analyser on media element → `AudioContext.createMediaElementSource`). Feasible but main-thread + CORS-clean (same-origin proxy ✓).
- Phased:
  - P4: `src/lib/smart-speed.ts`: `AudioContext` + `AnalyserNode`, RMS threshold gate; when silent >300ms and playing, ramp `playbackRate` to `silentRate` (e.g. 1.8×), restore on speech. Toggle in speed popover. Must `resume()` context on user gesture (autoplay policy).
  - Risk: `createMediaElementSource` once per element; survives `src` change but not element replace — element is stable (never remounted), OK. Transcode restarts keep element → graph persists.
- Tasks P1: pref `smartSpeed: boolean` default false + stub toggle disabled with "soon"? NO stubs allowed — either build P4 fully or omit toggle. Decision: implement full in P4; P1 ships without the row.

## 3.5 Frame-by-frame stepping (1 frame / 100ms when paused)

- Constraint: no fps metadata; `video.requestVideoFrameCallback` gives frame ticks but not fps. Use 100ms steps + `requestVideoFrameCallback`-aligned single advance when available.
- Tasks:
  1. Step buttons (±1 frame glyphs in `icons.tsx`: `StepBackIcon`, `StepFwdIcon`) visible when `state === 'paused'` (or always in a "precision" row).
  2. `stepFrame(dir: ±1)`: if transcode path → `seekAbsoluteRef.current(absolutePosition() + dir*0.1)` (100ms; remote restart cost — flashNotice warns "Frame step restarts transcode" first time). Else `video.currentTime = clampSeekTarget(video.currentTime + dir*(1/30), duration)` — assume 30fps fallback; use `requestVideoFrameCallback` to advance exactly one presented frame when supported: pause → `rvfc` once → set `currentTime += 1/60` minimal? Simplest correct: `video.currentTime += dir/30` is the standard approximation; document assumption.
  3. Keyboard: `,` / `.` step back/forward (extend `:1379-1414` switch; ignore when typing).
- Tests: pure `frameStep(current, dir, fps=30)` in `playback-rate.ts` + test.
- Acceptance: paused stepping visibly advances single frames on direct path; transcode path seeks ±100ms via absolute dispatcher.

## Files touched

- `src/lib/playback-rate.ts` (new + tests), `src/lib/player-prefs.ts` (playbackRate, pitchLock, smartSpeed, holdBoostRate cross-ref 02)
- `src/components/watch-player.tsx` (popover, slider, toggles, keyboard `,` `.`, Media Session extension, rate restore on source init)
- `src/components/icons.tsx` (StepBack, StepFwd; speed uses text badge)
