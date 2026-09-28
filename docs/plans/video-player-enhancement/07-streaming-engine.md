# 07 — Streaming Engine (Client)

Spec §3: Adaptive Buffer, ABR, Prefetch, Memory/Thread. Files: `src/components/watch-player.tsx`, `src/lib/stream-health.ts` (new), `src/lib/bandwidth.ts` (new), `src/lib/stats.ts` (new), `src/workers/prefetch.ts` (new), `src/lib/api.ts`, `src/app/api/mb/[...path]/route.ts`, `next.config.ts`.

## 0. Current knobs (all else stock)

- hls.js `maxBufferLength: 40, backBufferLength: Infinity` (`:575`); dash.js stock (`stableBufferTime 12, bufferToKeep 20`); no ABR seeding, no `startFragPrefetch`, no fetch priority, no prefetch, no IndexedDB.

## P0 (before anything): fix the delivery path

1. `/api/proxy` rewrite (~30s drop, `next.config.ts:14-16`) carries ALL segment/manifest bytes. Convert to a streaming route handler (no `arrayBuffer()` — pipe `ReadableStream` with `AbortSignal.timeout(120_000)`), or document reverse-proxy timeout. Without this, every P3/P4 optimization inherits random ECONNRESETs. (`route.ts:26,30` fully buffers `/api/mb` too — transcode segments via `mbUrl` inherit it; streaming fix covers both.)
2. `transcode_file` Range support is backend (08) — client notes `Range: bytes=` retries depend on it.

## 7.1 Dynamic buffer sizing (smart lookahead)

- Tasks:
  1. `src/lib/bandwidth.ts`: EWMA estimator `estimate(samples: {bytes, ms}[]): bps` (fast α=0.3, slow α=0.1, matching hls.js `abrEwmaFastVoD:3/Slow:9` semantics simplified) + `bufferTargetFor(bps): seconds` (e.g. <1Mbps→15s, <5Mbps→30s, else 60s; cap 120s per spec). Pure + tests.
  2. On `hlsRef`: set `hls.config.maxBufferLength = target` on `LEVEL_UPDATED`/1s tick; `hls.config.backBufferLength = min(30, target/2)` (first step away from `Infinity` — see 7.5). On dash: `dash.updateSettings({ streaming: { buffer: { stableBufferTime: target/2, bufferToKeep: 20 } } })`.
  3. Feed estimator from `hls.on(FRAG_LOADED)` (frag stats `loaded`, `loading.start`) + dash `fragmentLoadingCompleted` metric. No custom XHR needed P3.
- Acceptance: throttled-3G keeps ~15s buffer; fiber grows to 60s+; no oscillation (hysteresis 5s between changes).

## 7.2 Fast-start / zero-latency startup

- Tasks:
  1. hls.js: `abrEwmaDefaultEstimate: 500_000` → seed from `bandwidth.ts` last-known (persist `lastBps` in prefs) or 2Mbps; `startLevel = 0` (lowest) + `capLevelToPlayerSize: true`; `startFragPrefetch: true`.
  2. dash.js: `initialBitrate: { video: 400 }` (kbps) + `autoSwitchBitrate: { video: true }`.
  3. Measure: `playingSinceRef` → first `playing` event = startup ms; log to stats overlay (7.6). Target <300ms on warm cache (aspirational; report actual).
- Acceptance: frame-1 visible before chunk-2 upscale on 4G+.

## 7.3 Fetch priority + resource tiers

- Tasks: `fetch(url, { priority: 'high' })` (Fetch Priority API, Chromium) for active manifest/segment (hls.js `xhrSetup` hook sets `req.priority`? XHR has no priority — use `fetchSetup`? hls.js uses XHR by default; set `fragLoader`? Simplest: manifests via `fetch(priority:high)` custom loader; segments default). Subtitles/posters/next-episode metadata `priority: low`. Dash: `dash.extend` RequestModifier to set `priority`. P3: manifests high + subs low; segments inherit engine default.
- Acceptance: no regression; Lighthouse priority audit clean (manual).

## 7.4 Smart prefetch & next-episode seeding (P4)

- Tasks:
  1. `src/workers/prefetch.ts` (Web Worker): on `absolutePosition()/duration > 0.8` or end-credits chapter: `api.streams(next)` + `api.play(next)` (manifest URL only, no attach) + fetch first 2-3 segments `priority: low` into Cache API (`caches.open('prefetch-v1')`).
  2. Hover/scrub prefetch: on episode-list hover or seek-tooltip hover >300ms: fetch manifest `priority: low` (no segments).
  3. Seeding ≠ auto-transcode: never `POST /transcode/start` for N+1 (ffmpeg cost); only warm manifests + direct-file heads. Transcode pre-warm endpoint is backend-future (08).
- Acceptance: next-episode boot skips resolve (~1 RTT saved); no extra ffmpeg sessions spawned.

## 7.5 GC & buffer pruning (behavior change — gate it)

- `backBufferLength: Infinity` is deliberate (seek-back). Spec wants rolling 15s reverse.
- Tasks:
  1. Pref `backBuffer: 15|30|60|Infinity` default 30 (middle ground; 15 breaks long seek-back UX, Infinity OOMs 2h films).
  2. Apply to `hls.config.backBufferLength`; dash `bufferToKeep`. Forward-buffer eviction stays engine-default.
  3. Memory guard: if `performance.memory.usedJSHeapSize` > 80% `jsHeapSizeLimit`, force prune + `flashNotice("Memory saver")` (Chrome-only, guarded).
- Acceptance: 2h film heap stable; seek-back 30s works; pref respected.

## 7.6 Stats for Nerds (also listed 04.10 — build here)

- `src/lib/stats.ts`: `sampleStats(video, hls?, dash?): { fps, bitrate, codec, buffered, dropped, resolution, bwEstimate }` (1s poll; `requestVideoFrameCallback` for fps, `getVideoPlaybackQuality` for drops). `StatsOverlay.tsx` renders mono block. Pref `statsOpen`. Cheap P3.

## 7.7 Parallel chunk download (P5, monolithic MP4 only)

- Segmented HLS/DASH already multiplex via engine; parallel only matters for direct-file MP4.
- Tasks: worker pool (4) `Range:`-fetch 4MB slices, `SourceBuffer.appendBuffer` in order (MSE setup: `MediaSource` + `SourceBuffer('video/mp4; codecs=avc1')`). Requires backend Range (08 done first). High complexity — P5, behind pref `parallelMp4: false` default.
- Acceptance: 1GB MP4 seeks without full re-download; no SourceBuffer `QuotaExceededError` (evict behind playhead).

## 7.8 Main-thread offloading

- hls.js `enableWorker: true` already (transmux off-thread). dash.js default (main). Subtitle parse sync main thread (`captions.ts:23`) — move ASS/TTML parse to worker in P4 (`src/workers/sub-parse.ts`, transferrable strings, not VTTCues).
- Acceptance: 60fps scrub with ASS track (no jank in rAF).

## Files touched

- `src/lib/bandwidth.ts` + `stream-health.ts` (new + tests), `src/lib/stats.ts` (new), `src/components/StatsOverlay.tsx` (new)
- `src/workers/prefetch.ts`, `src/workers/sub-parse.ts` (P4, new)
- `src/components/watch-player.tsx` (engine config, FRAG hooks, estimator wiring, startup timer)
- `src/lib/player-prefs.ts` (backBuffer, lastBps, parallelMp4, statsOpen)
- `src/app/api/mb/[...path]/route.ts` + `next.config.ts` (P0 streaming fix)
