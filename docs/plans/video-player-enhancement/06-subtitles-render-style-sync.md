# 06 — Subtitles: Rendering, Styling & Sync

Spec §2: Anime-Specific Rendering, UI Customization, Sync Controls.
Files: `src/lib/captions.ts`, `src/components/watch-player.tsx`, `src/components/SubtitleOverlay.tsx` (new), `src/lib/sub-style.ts` (new), `src/lib/player-prefs.ts`, `src/app/globals.css`.

## 0. Renderer decision (P2, blocking for ASS/dual/style)

Native `TextTrack`/`VTTCue` gives: no font/stroke/box-opacity/Y-position control, no karaoke/rotation, no dual tracks, no DOM nodes for word lookup. Two options:

| | A: Native + `::cue` CSS | B: Custom overlay renderer (canvas/DOM) + JASSUB WASM for ASS |
|---|---|---|
| SRT/VTT basic | ✓ | ✓ |
| Typography/color/box/position | partial (`::cue` color/bg/font only) | full |
| ASS/SSA (karaoke, rotation, fonts) | ✗ | ✓ via JASSUB/libass WASM |
| Dual subs | ✗ (one showing track hack only) | ✓ (two absolutely-positioned layers) |
| Signs/lyrics filter | ✗ | ✓ (cue classification) |
| Word lookup | ✗ (no DOM) | ✓ (per-word spans) |
| MSE/HLS cue-matcher stalls | fights (`reattach`/`ensureActiveCues`) | sidesteps (own clock) |
| a11y / Media Session / `textTrack` UI | native free | must re-implement |
| New dep | none | `jassub` (+ worker, fonts) |

Decision: **hybrid**. Keep native TextTrack as default (SRT/VTT single, zero dep, a11y). Custom DOM overlay (`SubtitleOverlay.tsx`) activates when: dual enabled, ASS/SSA track chosen, signs-filter on, or word-lookup on. JASSUB loads lazily (`await import('jassub')`) only for ASS. Both renderers read the same normalized `SubtitleCue[]` (+ `assText` raw for JASSUB pass-through).

Tasks:
1. `captions.ts`: extend `SubtitleCue { start, end, text, settings?: {line,position,align}, ass?: string }`; `SubtitleTrackState { track, label, cues, source: 'native'|'overlay'|'jassub', cleanup }`. `parseSubtitleCues` keeps SRT/VTT; new `parseAssCues` (Dialogue: layer/start/end/style/text, strip/keep override tags) + `parseTtmlCues` (`<p begin dur>` → seconds) — pure + tests in `captions.test.ts`.
2. `SubtitleOverlay.tsx`: props `{ cues, currentTime (via rAF ref subscription), style: SubStyle, slot: 'bottom'|'top', onWordClick?, filter?: 'all'|'signs' }`; renders active cues as absolutely-positioned divs (bottom 8% default, top 8% for dual secondary). Word-lookup: split text into `<span>` per token, click → pause + dictionary popover (dictionary API P4 — Jisho/Anki-connect? stub data-first: show romaji via `wanakana`? keep to definition fetch from JMDict local? P4 scope; P2 ships pause + selection, lookup backend later).
3. JASSUB: `public/jassub-worker.js` + fonts; `attachJassubTrack(video, assText)` manages worker lifecycle; teardown on source switch. Add `jassub` to `package.json` (P4 only — P2 ships overlay without JASSUB, ASS degrades to stripped-dialogue rendering via `parseAssCues` text extraction).
4. Native path stays: `attachSubtitleTrack`/`reattach`/`ensureActiveCues` untouched for single SRT/VTT.

## 6.1 Dual subtitle mode

- Tasks:
  1. Player state: `chosenSub2: SubtitleOption | null`, `dualSubRef: SubtitleTrackState | null`, pref `dualSubs: boolean`.
  2. CC menu: "Second subtitle" section (same list, independent pick). When `dualSubs && chosenSub && chosenSub2`: primary → bottom overlay (or native if both SRT/VTT simple? simpler: both via overlay for consistent styling), secondary → top overlay.
  3. Offset/style apply per-track (separate `offsetMs2`, shared `subStyle`? per-track style P4 — P2 shares one style object).
- Acceptance: EN bottom + JP top render simultaneously; pause/seek keep both in sync (both read same rAF clock).

## 6.2 Signs & lyrics-only filter

- Tasks: cue classifier `classifyCue(text, style?)`: ASS `Style: Signs/Song/OP/ED` or VTT `region:signs` / `[sign]` prefix / italic-only lyric lines → `kind: 'dialogue'|'sign'|'song'`. Pref `subFilter: 'all'|'signs'`. Overlay renders only matching kind when filtered. Native path: filter unsupported (document; overlay auto-activates when filter ≠ all).

## 6.3 Sync offset (±ms, slider + G/H keys)

- Problem: cues baked into `VTTCue` at attach — no offset field.
- Tasks:
  1. `SubtitleTrackState` gains `offsetMs: number`; renderers apply `t' = t - offsetMs/1000` (overlay: shift lookup window; native: re-attach with shifted cues — `attachSubtitleTrack(video,label,shiftCues(cues,offsetMs))`, cheap enough on slider release, live-preview on input via overlay only).
  2. `shiftCues(cues, ms)` pure + tests.
  3. UI: CC menu "Sync" row → slider `-2000..+2000ms step 50` + readout; keyboard `g` (-100ms) / `G` (-500ms)? spec says G/H — `g` delay +100? Convention (mpv): `z`/`Z`? Spec mandates G/H: `g` = -50ms? Use: `g` -100, `h` +100, shift for ±500. `flashNotice("Subs +150ms")`. Persist `subOffsetMs` (+`subOffsetMs2`).
- Acceptance: desync fix visible within one slider drag; survives seek + source switch (offset in state, reapplied in `reapplyCaptions`).

## 6.4 SDH & audio-description badges

- Tasks: CC menu rows show badges from wire flags (`SDH`, `FORCED`, `CC`, format tag `ASS`/`VTT`). Pref `preferSDH: boolean` influences auto-select (05.5). No filtering-out (always listed; badges inform).

## 6.5 Styling engine (typography, color, box, position)

- Prefs `subStyle: { font: 'sans'|'serif'|'mono'|'anime', weight, scale (0.5-2.0), color, stroke, shadow, bg, bgOpacity (0-1), yOffset (px or %) }`.
- Tasks:
  1. `src/lib/sub-style.ts`: `SubStyle` type + `DEFAULT_SUB_STYLE` + `styleToCss(style): React.CSSProperties` (textShadow for stroke, background rgba from bg+opacity, fontSize `calc(1rem * scale)`, transform translateY). Pure + tests.
  2. Overlay applies `styleToCss`; native path applies subset via `::cue` CSS variables (`globals.css`: `video::cue { color: var(--sub-color); background: var(--sub-bg); font-size: var(--sub-size) }` — stroke/shadow/position native-impossible, document).
  3. CC menu "Style" section: font radio, scale slider 50-200%, color swatches, bg opacity slider, Y-offset slider (-20%..+20%). Live preview (overlay re-renders on style state; native re-applies CSS vars instantly).
- Acceptance: 200% anime-sans yellow-on-black at top-third renders; persists across titles.

## Files touched

- `src/lib/captions.ts` (Cue/State extension, ASS/TTML parsers, shiftCues, classifier)
- `src/components/SubtitleOverlay.tsx` (new), `src/lib/sub-style.ts` (new + tests)
- `src/components/watch-player.tsx` (dual state, offset, style UI, keyboard g/h, overlay mount, JASSUB lazy)
- `src/lib/player-prefs.ts` (dualSubs, subOffsetMs(2), subStyle, subFilter, preferSDH)
- `src/app/globals.css` (`::cue` vars, overlay classes)
- `package.json` (P4: `jassub`; P4: `wanakana`? lookup only)
