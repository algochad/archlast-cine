"use client";

import type { StatsSnapshot } from "@/lib/stats";

function formatBitrate(bps: number | null): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return "—";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
  return `${bps} bps`;
}

function formatBuffered(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  return `${sec.toFixed(1)}s`;
}

export function StatsOverlay({ stats }: { stats: StatsSnapshot }) {
  return (
    <div className="pointer-events-none absolute left-3 top-20 z-20 max-w-[min(92vw,420px)] rounded border border-white/10 bg-black/75 px-3 py-2 font-mono text-[11px] leading-4 text-zinc-100 backdrop-blur">
      <div className="mb-1 text-[9px] font-bold tracking-[0.2em] text-brand">STATS FOR NERDS</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-zinc-400">FPS</span>
        <span className="tabular-nums text-white">{stats.fps != null ? stats.fps.toFixed(1) : "—"}</span>
        <span className="text-zinc-400">Bitrate</span>
        <span className="tabular-nums text-white">{formatBitrate(stats.bitrate)}</span>
        <span className="text-zinc-400">Codec</span>
        <span className="truncate tabular-nums text-white">{stats.codec ?? "—"}</span>
        <span className="text-zinc-400">Buffer</span>
        <span className="tabular-nums text-white">{formatBuffered(stats.buffered)}</span>
        <span className="text-zinc-400">Dropped</span>
        <span className="tabular-nums text-white">{stats.dropped}</span>
        <span className="text-zinc-400">Resolution</span>
        <span className="tabular-nums text-white">{stats.resolution}</span>
      </div>
    </div>
  );
}
