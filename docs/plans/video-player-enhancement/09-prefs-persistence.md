# 09 — Player Prefs & Persistence

All sections' settings. Files: `src/lib/player-prefs.ts` (new), `src/lib/session.tsx`, `src/lib/session-contract.ts`, `src/lib/account.ts`, `src/lib/api-account.ts`, `src/app/api/account/settings/route.ts` (no change), `api/src/{common/account.types.ts, users/*}`, `api/prisma/schema.prisma`, `src/app/account/page.tsx`.

## 0. Rules

- Anon-first: every pref works logged-out (localStorage). Account = cross-device mirror for a subset.
- Backend-before-frontend (Nest `whitelist:true` drops unknown keys with 200).
- `SessionState.settings` inlines `{region; provider}` (`session-contract.ts`) — widen in lockstep with `AccountSettings`.
- Don't touch `watch-sync.ts` throttle/completion semantics except the `0.98` move (below).

## 9.1 Local tier (P0): `src/lib/player-prefs.ts`

Mirror `history.ts` pattern (own key, swallowing catch):

```ts
export interface PlayerPrefs {
  seekStep: 5|10|15|30|60; timeMode: 'elapsed'|'remaining';
  playbackRate: number; pitchLock: boolean; smartSpeed: boolean; holdBoostRate: 1.5|2|2.5|3;
  volume: number; muted: boolean; volumeBoost: boolean; normalize: boolean; brightness: number;
  aspectMode: 'contain'|'cover'|'fill'; filter: 'none'|'anime'|'contrast'; nightDim: number;
  autoplay: boolean; autoplayDelay: number;
  prefSubLang: string[]; prefAudioLang: string[]; prefForced: boolean; preferSDH: boolean;
  dualSubs: boolean; subOffsetMs: number; subOffsetMs2: number; subStyle: SubStyle; subFilter: 'all'|'signs';
  backBuffer: 15|30|60|0 /*0=Infinity*/; lastBps: number; parallelMp4: boolean; statsOpen: boolean;
  locked?: never /* session-only, never persisted */;
}
export const DEFAULT_PLAYER_PREFS: PlayerPrefs = { seekStep: 10, timeMode: 'elapsed', playbackRate: 1, pitchLock: true, smartSpeed: false, holdBoostRate: 2, volume: 1, muted: false, volumeBoost: false, normalize: false, brightness: 1, aspectMode: 'contain', filter: 'none', nightDim: 0, autoplay: true, autoplayDelay: 10, prefSubLang: ['en'], prefAudioLang: ['ja','en'], prefForced: true, preferSDH: false, dualSubs: false, subOffsetMs: 0, subOffsetMs2: 0, subStyle: DEFAULT_SUB_STYLE, subFilter: 'all', backBuffer: 30, lastBps: 2_000_000, parallelMp4: false, statsOpen: false };
export function getPrefs(): PlayerPrefs // merge stored over defaults, coerce invalid
export function setPrefs(patch: Partial<PlayerPrefs>): PlayerPrefs // write-through, return merged
export function subscribePrefs(fn): () => void // optional; else read on mount + write on change
```

- Key `moviebox.prefs.v1`. Coercion: reuse `resolveSeekStep`, `clampRate` etc. (single validation home per domain).
- Wire into `watch-player.tsx`: replace literals (seek ±10 `:1387/1391`, volume init `:109-110`, autoplay countdown `:1349`, `backBufferLength :575`, estimator seed).
- `seek.ts`: home for `SeekStep` union (already pure+tested).
- Tests: `player-prefs.test.ts` (defaults, corrupt-JSON→defaults, partial merge, coercion).

## 9.2 Account tier (P0, after local): cross-device subset

Sync subset (small, stable): `{ seekStep, playbackRate, autoplay, prefSubLang, prefAudioLang, subStyle, aspectMode }`. Everything else device-local (volume, brightness, stats, offsets? offsets per-title — local only).

1. `api/prisma/schema.prisma`: `User.settings Json @default("{}")` — one migration, covers `auth.service.register` (creates with defaults). No ~20 scalars.
2. `api/src/common/account.types.ts`: `PlayerPrefsDto` shape + `toAccountSettings` deep-merge defaults.
3. `api/src/users/dto/update-user.dto.ts`: `@IsOptional() @ValidateNested() @Type(() => PlayerPrefsDto) player?` (follow `WatchEntryDto` idiom: `@IsIn/@Min/@Max/@IsNumber`).
4. `api/src/users/users.service.ts`: serialize nested `player` explicitly (no straight passthrough).
5. `src/lib/account.ts` `AccountSettings` += `player: PlayerPrefsSubset`; `session-contract.ts` settings widen in lockstep.
6. `session.tsx`: after `refresh`/status-authed, merge server `player` over local (server-wins-with-local-seed, first sign-in only — flag `prefsSeeded` in localStorage to avoid clobbering later local changes); writes debounce 2s → `accountApi.updateSettings({ player })`. No new Next route (`settings/route.ts` forwards verbatim ✓).
7. Account page (`src/app/account/page.tsx`): player prefs section (seek step radio, autoplay toggle, sub lang, default speed) reusing settings `busy` pattern.

## 9.3 End-of-title semantics (replay + autoplay change this)

- `0.98` duplicated (`history.ts:48`, `watch-sync.ts:64`). Replay (01.2) re-records after removal; autoplay countdown (04.4) navigates away.
- Tasks: extract `isComplete(position, duration)` to `history.ts` (single home), use in both + player ended paths. Replay: `endedRef.current=false` + `recordWatch(fresh)` on replay click.

## 9.4 Regression surface (keep green)

`watch-sync`, `history`, `history-merge`, `session-contract`, `account`, `api-account`, `seek-{routing,pin,commit}` tests pin throttle/force/local-only/ordering — any `recordWatch` reorder breaks intentional assertions. Run `npm test` per phase.

## Files touched

- `src/lib/player-prefs.ts` (new + tests), `src/lib/seek.ts`, `src/lib/history.ts` (isComplete)
- `src/lib/session.tsx`, `session-contract.ts`, `account.ts`, `api-account.ts`
- `api/prisma/schema.prisma` (migration), `api/src/common/account.types.ts`, `api/src/users/{users.service.ts, dto/update-user.dto.ts}`
- `src/app/account/page.tsx` (prefs UI), `src/components/watch-player.tsx` (reads/writes)
