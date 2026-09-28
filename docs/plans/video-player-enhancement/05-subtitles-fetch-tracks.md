# 05 — Subtitles: Track Management & Fetching

Spec §2: Track Management & Fetching Features. Files: `src/lib/captions.ts`, `src/components/watch-player.tsx`, `src/lib/types.ts`, `src/lib/api.ts`, `src/app/api/mb/[...path]/route.ts`, `MovieBox-Tui/server/src/main.rs`, `MovieBox-Tui/src/providers/moviebox/*.rs`, `MovieBox-Tui/src/service.rs`, `MovieBox-Tui/src/providers/models.rs`.

## 0. Current state recap

- SRT/VTT only, moviebox-only (`if provider !== 'moviebox' return []` `:395`), single track, label-only identity, `srclang 'en'` hardcoded (`:120`), no format/lang/forced/SDH flags.
- `SubtitleOption = {name,url}` (`types.ts:98`); `CaptionsResponse = {id, subtitles[]}` (`:149`). Wire crosses two crates + Next route.
- Fetch: `fetchSubtitleText` mints ticket with `headers: []` (`:411-415`) → silent 403s on Referer-gated CDNs.
- `Release.resource_id` on wire (`:95`) but never sent to captions; `service.rs:215` early-exit dead → every title pays 3-sibling fan-out.
- `media-types.ts:125/147` has richer `Subtitle {language, url, label?}` + `Stream.subtitles?` — zero consumers, the intended shape.

## 5.1 Wire schema extension (backend-first, whitelist safe)

Tasks (backend → client in lockstep):
1. `MovieBox-Tui/src/providers/models.rs:218`: extend `SubtitleOption { name, url, language?: string, format?: string, forced?: bool, sdh?: bool, embedded?: bool }`. `format` = "srt"|"vtt"|"ass"|"ssa"|"ttml"|"embedded".
2. `adapt.rs:6` `captions_json_to_options`: populate new fields from upstream payload (upstream may not have all; default empty/false). **Dedupe key widens to `(url, language, format, forced, sdh)`** — otherwise language-dedupe collapses forced/SDH variants (`service.rs:279`).
3. `service.rs:198` `get_ext_captions`: forward `resource_id` (fix early-exit), collect `forced`/`sdh` from payload if present.
4. `main.rs:639` `captions`: send full shape; `CaptionsResponse` JSON auto-serializes new fields (serde default).
5. `src/lib/types.ts:98` `SubtitleOption` + `CaptionsResponse` widen (optional fields, no breaking).
6. `api.captions(id, resource_id?)` add optional `resource_id` param; `watch-player.tsx` passes it when available on the active `Release`.
7. `fetchSubtitleText`: forward `SourceMirror.headers` from active release into ticket mint (`headers: rel.mirrors[0].headers` or all mirrors' headers? one ticket per mirror? → ticket dedupe is `(url,headers)` — include first mirror's headers). If multiple mirrors, create multiple tickets? Simpler: pick first mirror's headers; backend `insert_dedup` handles cross-host via foreign tickets. Fix: `fetchSubtitleText(opt, releaseHeaders?)`.
8. Result: no more silent 403s; early-exit re-enabled; language/format flags available for UI.

## 5.2 HLS/DASH soft-sub extraction (frontend + backend)

- `playback.ts` has zero subtitle awareness; `main.rs` proxy rewrite ignores subtitle lines.
- Tasks:
  1. `playback.ts`: new `sniffSubtitles(text: string, isHls: boolean): { language: string; url: string; kind: 'subtitles'|'captions'; forced?: bool; embedded?: bool }[]` — parse HLS `EXT-X-MEDIA:TYPE=SUBTITLES` (groups with `URI`, `LANGUAGE`, `FORCED=YES/NO`, `CHARACTERISTICS`) and DASH `<AdaptationSet contentType="text">` (Representation `lang`, `roles`, `subsegmentAlignment` etc.).
  2. `startSource` (after sniff/manifest fetch): call `sniffSubtitles`; merge into `subOptions` (tag `source: 'manifest'`). Dedupe by `(url, language)` against backend list.
  3. Backend manifest rewrite (`main.rs:978-1035`): extend regex to preserve/rewrite subtitle URIs. HLS: rewrite `URI=` lines to `/api/proxy/{ticket}/a...`; DASH: rewrite `BaseURL`/`SegmentTemplate` inside text adaptation sets. Add `foreign` tickets for cross-host subtitle segments (same `insert_dedup` path).
  4. `src/lib/types.ts`: `Stream.subtitles` array populated from sniffed tracks (per-stream, not title-level). `MediaDetails` maybe not — streams response is per-episode.
  5. UI: manifest tracks appear in CC menu with badges "Manifest" + language/format; priority over external fetch.

## 5.3 External subtitle providers (OpenSubtitles, Subscene, AnimeSkip, Jimaku)

- Not in repo. Must implement fetchers (client or server-side). Decision: server-side in Rust (caching, auth, rate-limit) — web client already proxies through backend for auth headers.
- Tasks:
  1. New endpoint `GET /api/subtitles/search?provider=opensubtitles|subscene|aniskip|jimaku&hash=&title=&episode=&release_group=&lang=` → proxies to external API, normalizes to `SubtitleOption[]`.
  2. Client: "Search subtitles" row in CC menu (when external providers enabled in prefs) opens search modal → results merge into `subOptions` with badge "OpenSubtitles" etc.
  3. Hash matching: compute file hash client-side? Web can't read response bytes easily (stream). Better: backend has file access via proxy — backend computes hash. `POST /api/subtitles/by-hash` with `ticket` + `range` to read first 64KB? Or backend fetches full file once and caches. Scope P4 — P1 ships backend search endpoint with title/episode/season query (AnimeSkip has season/ep), wire later.

## 5.4 Local file side-loading

- Tasks:
  1. CC menu: "Load subtitle file" row → `<input type="file" accept=".srt,.vtt,.ass,.ssa,.ttml" style="display:none">` click → `file.text()` → `parseSubtitleCues` (needs ASS/TTML parser — see 06) → `applyChosenCaptions` bypassing fetch.
  2. Store in prefs `loadedSubs: {url: string (blob:), cues: SubtitleCue[], meta}` for re-apply on source switch.
  3. Must survive `teardown` (track persists) and `reapplyCaptions` (uses `subTrackRef` — for local, extend to accept `cues` directly without URL fetch).
  4. `SubtitleOption` for local: `name: file.name, url: 'blob:...'` with `format` from extension, `language: 'local'`.

## 5.5 Language preferences & auto-selection

- Tasks:
  1. Prefs: `prefSubLang: string[]` (e.g. `['en','eng']`), `prefAudioLang: string[]`, `prefForced: boolean`, `prefSDH: boolean`.
  2. On `loadSubtitleOptions` + manifest sniff: auto-select first matching `language`/`forced`/`sdh` against prefs; if none, default to first English. Populate `chosenSub` without user click (initial).
  3. Persist selected language per title? Not now — global prefs only.
  4. Forced subs: when `prefForced && chosen audio is dub`, auto-enable first `forced:true` track even if `chosenSub` was null. Requires audio track language data (see 04.2).

## 5.6 Provider gating fix

- Replace hardcoded `if (provider !== 'moviebox') return []` (`watch-player.tsx:395`) with capability check:
  1. `useSession` doesn't expose provider caps; `api.health()` returns `HealthResponse.providers[].capabilities.supports_subtitles` (`types.ts:166`).
  2. Cache caps in `player-prefs` or session; on boot, if active provider has `supports_subtitles: false`, hide CC button entirely (not empty list — invisible). If true but list empty, show "No subtitles available" row.

## Files touched

- `src/lib/types.ts` (SubtitleOption, CaptionsResponse, Stream.subtitles?)
- `src/lib/captions.ts` (parse extension for ASS/TTML later; new `source` field in track state)
- `src/lib/playback.ts` (sniffSubtitles)
- `src/lib/api.ts` (captions + resource_id, new search endpoint)
- `src/components/watch-player.tsx` (fetchSubtitleText headers, auto-select, local loader, provider cap check)
- `src/lib/player-prefs.ts` (prefSubLang, prefAudioLang, prefForced, prefSDH, loadedSubs)
- `MovieBox-Tui/src/providers/models.rs` (SubtitleOption fields)
- `MovieBox-Tui/src/providers/moviebox/adapt.rs` (captions_json_to_options dedupe widen)
- `MovieBox-Tui/src/service.rs` (get_ext_captions forward resource_id, collect forced/sdh)
- `MovieBox-Tui/server/src/main.rs` (captions handler, manifest rewrite subtitle support)
- `MovieBox-Tui/src/providers/moviebox/mod.rs` (upstream call unchanged)