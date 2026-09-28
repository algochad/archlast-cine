# 08 — Backend: Proxy, Transcode, Sprites, Chapters

Spec §3 (proxy/transcode) + thumbnail/chapter/skip prerequisites for 01/04.
Files: `MovieBox-Tui/server/src/main.rs` (~2270 lines), `MovieBox-Tui/server/Cargo.toml`, `MovieBox-Tui/src/net.rs`, `MovieBox-Tui/src/cache.rs`, `MovieBox-Tui/src/providers/{models.rs,anime/client.rs,moviebox/*}`, `MovieBox-Tui/src/service.rs`, `src/lib/api.ts`, `src/lib/types.ts`, `Dockerfile`, `scripts/dev.mjs`.

## 0. Invariants (never violate)

- Deadlock rule: never hold registry mutex across await/spawn (insert-then-spawn-then-register).
- `TranscodeConfig::from_env` (`:234-250`) read once at startup — new knobs there (`MOVIEBOX_SPRITE_INTERVAL`, `MANIFEST_CACHE_TTL`, `MIRROR_PROBE_TIMEOUT`), not per-request.
- `valid_transcode_filename` (`:1549`) whitelist + `seg%05d.ts` naming load-bearing for wipe/produced-count.
- `ticketFromUrl` regex (`watch-player.tsx:477`) assumes `/api/proxy/<16-40 hex>/…` — don't change shape.
- Deps: axum 0.8 / tokio / reqwest(rustls) / parking_lot / rand 0.10. New crates need justification; prefer ffmpeg flags.

## B0 Correctness fixes (P0, before features)

1. **Ticket expiry vs long transcodes.** Ticket 30-min TTL (`TicketStore :70`), no renewal on `get` (`:148`); 2h film at ~1× dies mid-title when ffmpeg re-fetches. Fix: transcode session holds non-expiring internal ticket ref (clone headers into session at `transcode_start`, bypass store expiry), or `touch()` on every proxy fetch from session ffmpeg UA. Preferred: session-owned header snapshot (no store coupling).
2. **Lazy prune leaks.** Sessions pruned only inside `transcode_start` (`:1370`) / `transcode_state` (`:1568`); abandoned dirs leak until next request. Add tokio background janitor (interval 5min, same `prune_locked`) — first spawned task in server (follow insert-then-spawn pattern at `main`).
3. **`transcode_file` whole-read + no Range** (`:1837` `tokio::fs::read`, flat 200). Fix: stream via `tokio::fs::File` + `ReaderStream`, parse `Range`, 206 + `Content-Range`, `Accept-Ranges: bytes`, `Cache-Control: public, max-age=31536000, immutable` (segments immutable post-write).
4. **`/api/mb` buffering** (`route.ts:26,30`): stream transcode/manifest responses (`Readable.fromWeb` passthrough) — pairs with 07-P0.

## B1 Thumbnail sprites (for 01.5)

1. Second ffmpeg pass at `transcode_start` (or on-demand `POST /transcode/{s}/sprites`): `-skip_frame nokey -vf fps=1/10,scale=160:90,tile=10x10` → `sprite-N.jpg` every 100s + `thumbs.vtt` (WebVTT `00:00.000 --> 00:10.000\nsprite-0.jpg#xywh=…`). Interval via `MOVIEBOX_SPRITE_INTERVAL` (default 10s).
2. `valid_transcode_filename`: allow `sprite-\d+\.jpg`, `thumbs\.vtt` (+ per-extension content-type map in `transcode_file`).
3. `wipe_transcode_outputs` (`:1270`): EXCLUDE sprites/vtt (keyed to absolute content time, seek-safe).
4. `api.ts`: `transcodeSprites(session)` → `{ vtt_url }`; `types.ts`: `TranscodeSpritesResponse`. Tooltip (01.5 P4) fetches VTT once, maps time→sprite+xywh.
5. Direct-file (non-transcode) thumbs: on-demand `GET /api/thumbs?ticket=&t=` single-frame (`-ss t -frames:v 1 -s 160x90`) with short cache — P5 (ffmpeg per-hover cost).

## B2 Chapters & skip markers (for 01.7, 04.4)

1. **Expose IDs:** `anime/client.rs:258` `id_mal` + `:1245` `get_mal_id_for_anime` exist internally; surface `anilistId`/`malId` on `MediaDetails` (`models.rs`) → `/api/details` → `types.ts MediaDetails.animeIds?`. Non-anime: `ffprobe -show_chapters` (add `ffprobe` resolve next to `resolve_ffmpeg :1085`; Dockerfile already has ffmpeg — `ffprobe` ships with it; dev hosts need it on PATH, document).
2. **New endpoint** `GET /api/skip-markers?provider=&id=&season=&episode=&anilistId=&malId=` → AniSkip (aniskip.moe) for anime OP/ED; container chapters via ffprobe for others; HLS `#EXT-X-DATERANGE` / DASH periods as fallback. Cache in `cache.rs` `RedisCache` (short TTL 24h; markers stable per episode). Response: `{ markers: [{start,end,kind:'op'|'ed'|'intro'|'preview',label}] }`.
3. **Transcode preserves markers:** `transcode_args` (`:1103-1161`) drops chapters — add `-map_metadata 0` (or at least copy `duration_seconds`-adjacent chapter sidecar; simplest: backend returns markers from pre-transcode probe, client uses those — no ffmpeg chapter copy needed P1).
4. `api.ts`: `skipMarkers(provider,id,season,episode)`; `types.ts`: `SkipMarker`, `SkipMarkersResponse`. Client merges into `Chapter[]` (01.7).

## B3 Manifest edge cache + rewrite unification

1. Cache rewritten manifests keyed `(ticket, upstream_url)` TTL `MANIFEST_CACHE_TTL` (default 5s for live-ish playlists, 60s for VOD MPD) in `RedisCache` + in-memory LRU; ETag/`If-None-Match` passthrough; single-flight (tokio `OnceCell` per key or dedup map) against playlist-refresh herds.
2. Unify rewrite: backend DASH branch (`:1043` naive replace) → proper XML-aware rewrite (BaseURL/SegmentTemplate/`$Number$`/`$Time$`), subsuming client `rewriteRelativeTo` (`playback.ts:369`) — client keeps Blob path as fallback until backend proven, then delete duplicate.
3. Subtitle URI rewrite (05.2): HLS `URI=` + DASH text AdaptationSets via same path + foreign tickets.

## B4 Mirror health + rotation (for 07 client failover)

1. `play` (`:729-803`) hard-takes `mirrors.first()` (`:768`). Add: ordered probe (HEAD/first-segment, timeout `MIRROR_PROBE_TIMEOUT` default 3s, concurrent, pick fastest-200) OR failover params `GET /api/play?exclude=<label>` so client rotates on 403/504/slow-chunk (>1500ms per 07 `stream-health.ts`).
2. `POST /api/proxy/{ticket}/rotate` (re-mint same ticket id → new upstream, position-safe) — preferred: ticket id stable, `ticketFromUrl` regex unaffected, player keeps `play_url`.
3. `Release.mirrors` order stays provider-supplied; health result cached per `(provider, resource_id)` 60s.

## B5 Transcode ladder + tracks (P5)

- Today: single rendition, `0:v:0+0:a:0`, no subs. P5: `-var_stream_map "v:0,a:0 v:1,a:1"` two-rendition (480p+1080p) + `-map 0:s?` sidecar WebVTT (`-f webvtt subs.vtt`); master playlist `master.m3u8`. Client ladder switch (07) uses it. ffmpeg cost ×2 — gate behind `MOVIEBOX_TRANSCODE_LADDER=0/1` default 0.
- Keep-alive: `net.rs` pooled already; raise `pool_max_idle_per_host 8→32` for segment fan-out; no H2/H3 tuning (reqwest default; document).

## B6 Config & ops

- `TranscodeConfig`: `SPRITE_INTERVAL`, `MANIFEST_CACHE_TTL`, `MIRROR_PROBE_TIMEOUT`, `TRANSCODE_LADDER`, sprite on/off. `Dockerfile`: ffmpeg present ✓ (ffprobe same package ✓). `scripts/dev.mjs`: `MOVIEBOX_PROXY_BASE` default localhost:3000 ✓ (keep for manifest absolute URLs).
- Health: add `transcode: { enabled, ffmpeg: bool }` to `/health` (`:2140-2165`) so UI pre-detects 503 path ([INFERENCE] — verify field absent before adding).

## Files touched (backend)

- `MovieBox-Tui/server/src/main.rs` (B0-B6), `server/Cargo.toml` (only if crate needed — avoid)
- `MovieBox-Tui/src/{net.rs, cache.rs, service.rs, providers/models.rs, providers/anime/client.rs, providers/moviebox/{mod.rs, adapt.rs}}`
- `src/lib/api.ts` + `src/lib/types.ts` (sprites, skip-markers, play exclude, health transcode)
- `Dockerfile` (document ffprobe), `scripts/dev.mjs` (new env passthrough)
