# 02 — Touch Gestures

Spec §1: Advanced Touch Screen Gestures. Files: `src/components/watch-player.tsx`, `src/hooks/use-gestures.ts` (new), `src/lib/player-prefs.ts`, `src/app/globals.css`.

## 0. Constraints (read first)

- Only `onTouchStart={pokeControls}` exists today; no `touchmove`/`touchend`, no pointer-id bookkeeping.
- `.player-range { touch-action: pan-y }` — vertical page-pan wins over JS. New gesture surface needs `touch-action: none`; do NOT mutate `.player-range`.
- Transcode seeks = full ffmpeg restart (seconds). Rapid gesture seeks MUST debounce through `queuedRemoteSeekRef` (drained in `remoteSeek` finally). Naive multi-tap = backend storm.
- Screen-lock (04) must intercept the whole gesture layer, not just Escape.

## 2.1 Gesture surface (shared prerequisite)

- Tasks:
  1. New `src/hooks/use-gestures.ts`: attaches `pointerdown/move/up/cancel` on a transparent layer `<div className="gesture-layer">` covering video (inside `containerRef` so fullscreen-safe, z below controls `z-20`, above video). `touch-action: none` on this layer only.
  2. Export callbacks: `onDoubleTap(side)`, `onSwipe(side, dy)`, `onHoldStart/onHoldEnd`, `onPinch(scale)`. Track `pointerId`, timestamps, positions; multi-touch map for pinch.
  3. Single-tap passthrough: tap (no move, <250ms, single pointer) → `togglePlay()` (preserve current `video onClick` behavior; move it onto layer to avoid double-fire — remove `onClick={togglePlay}` from `<video>` once layer owns taps).
  4. Respect `lockedRef` (04): all handlers early-return when locked except lock-toggle affordance.
  5. Respect control-visibility: gestures `pokeControls()` on each recognized gesture.
- Tests: pure gesture classifier in `src/lib/gestures.ts` (`classifyTap(count, dt)`, `swipeDelta`, `holdDuration`) + vitest; hook thin.

## 2.2 Double-tap seek + multi-tap acceleration

- Spec: double-tap left = rewind, right = fast-forward; consecutive rapid taps scale (2×=10s, 3×=20s, 4×=30s).
- Tasks:
  1. `gestures.ts`: `tapWindowMs = 300`; count taps within window on same side; `jumpForTaps(n, baseStep) = baseStep * (n>=4 ? 3 : n>=3 ? 2 : 1)` — configurable base = `seekStep` pref (01).
  2. Layer: double-tap left third → `seekBy(-jump)`, right third → `seekBy(+jump)`; center third reserved (single-tap play, double-tap? nothing — avoid conflict).
  3. HUD: `flashNotice("-10s")` / `+20s` style; also transient side-flash animation div (CSS keyframe, 300ms fade).
  4. Transcode storm guard: taps dispatch through `seekBy` → `seekAbsolute` → `queuedRemoteSeekRef` collapse. Additionally debounce gesture seeks 400ms (trailing-edge: commit latest) — implement in hook, not in `seekAbsolute`.
- Acceptance: 2/3/4 rapid taps on right seek +10/+20/+30 (with base 10); single backend restart on transcode path.

## 2.3 Vertical swipe: brightness (left) / volume (right)

- Tasks:
  1. Right-side vertical drag → `onVolume(video.volume - dy*k)` (reuse `onVolume` `:1124`, clamp 0-1, unmute on up).
  2. Left-side vertical drag → software brightness overlay (no Browser Brightness API on web): fullscreen `div bg-black opacity={1-b}` pointer-events-none, `b` in prefs `brightness: 0.3-1.0` default 1. Show `flashNotice("Brightness 80%")` throttled.
  3. Only when gesture started on respective third AND moved mostly vertical (`|dy| > 2*|dx|`, >24px). Horizontal swipes reserved (future: scrub; currently ignore).
  4. Persist `brightness` + `volume` in prefs (local).
- Acceptance: right swipe changes volume without moving seek; left swipe dims without pausing; no conflict with fine-scrub (different layer: scrub owns range input, gestures own video layer).

## 2.4 Press-and-hold speed boost (2× or user rate)

- Tasks:
  1. Long-press (>450ms, <10px move, single pointer, anywhere on layer) → save `prevRate = video.playbackRate`, set `video.playbackRate = boostRate` pref (default 2.0), `flashNotice("2× speed")`.
  2. Release → restore `prevRate`. Cancel on multi-touch or lock.
  3. Prefs: `holdBoostRate: 1.5|2.0|2.5|3.0` default 2.0.
  4. Interacts with 03-speed: boost overrides switcher temporarily; switcher change during hold updates `prevRate`, not live rate.
- Tests: classifier `holdFired(downMs, movePx)` pure + test.

## 2.5 Pinch-to-zoom / aspect control

- Tasks:
  1. Two-pointer pinch on layer → `scale` ratio; map to `object-fit` cycle? Spec: pinch-out fills ultra-wide (crop top/bottom, remove letterbox).
  2. `video.style.objectFit`: `'contain'` default; pinch-out beyond 1.15 → `'cover'`; pinch-in below 0.9 → `'contain'`. Persist `aspectMode` (see 04 for full selector: Auto/Strech/Zoom/Fit — pinch writes Zoom/Fit entries).
  3. HUD `flashNotice("Zoom: fill")`.
- Acceptance: pinch toggles cover/contain without reload; no seek/pause side effects.

## Files touched

- `src/hooks/use-gestures.ts` (new), `src/lib/gestures.ts` (new pure classifier + tests)
- `src/components/watch-player.tsx` (layer JSX, wire callbacks, remove video onClick)
- `src/lib/player-prefs.ts` (seekStep reuse, holdBoostRate, brightness, aspectMode)
- `src/app/globals.css` (`.gesture-layer`, side-flash keyframes, brightness overlay)
