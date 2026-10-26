"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContinueCard } from "@/components/continue-card";
import { ClockIcon } from "@/components/icons";
import type { WatchEntry } from "@/lib/account";
import { accountApi, importHistory } from "@/lib/api-account";
import { clearProgress, entryKey, getHistory } from "@/lib/history";
import { mergeEntries } from "@/lib/history-merge";
import { useServerHistory, useSession } from "@/lib/session";
import type { ProviderId } from "@/lib/types";

/**
 * Continue-watching rows the desktop client persists on this machine
 * (Rust `GET /api/mb/local-history`). A missing or failing endpoint yields an
 * empty list, which hides the import panel.
 */
async function fetchDesktopHistory(): Promise<WatchEntry[]> {
  try {
    const res = await fetch("/api/mb/local-history", { cache: "no-store" });
    if (!res.ok) return [];
    const payload = (await res.json()) as { entries?: WatchEntry[] };
    return Array.isArray(payload.entries) ? payload.entries : [];
  } catch {
    return [];
  }
}

export default function HistoryPage() {
  const { status } = useSession();
  const { entries, ready, remove } = useServerHistory();

  // Desktop scan: one request per page load, shared across renders so a
  // StrictMode remount reuses the in-flight promise instead of refetching.
  const desktopRequest = useRef<Promise<WatchEntry[]> | null>(null);
  const [desktopEntries, setDesktopEntries] = useState<WatchEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The session store reloads history on sign-in only, so the authoritative
  // read that follows an import is mirrored here for this page's lifetime.
  const [importedEntries, setImportedEntries] = useState<WatchEntry[] | null>(null);
  // Progress recorded on this device (signed out, or not yet synced).
  const [local, setLocal] = useState<WatchEntry[]>([]);

  useEffect(() => {
    setLocal(getHistory().map((e): WatchEntry => ({ ...e, updatedAt: e.updated })));
  }, []);

  useEffect(() => {
    if (status !== "authed") return;
    let active = true;
    const pending = desktopRequest.current ?? (desktopRequest.current = fetchDesktopHistory());
    void pending.then((found) => {
      if (active) setDesktopEntries(found);
    });
    return () => {
      active = false;
    };
  }, [status]);

  const source = status === "authed" && importedEntries ? importedEntries : entries;
  const sorted = useMemo(
    () => mergeEntries(source, local).sort((a, b) => b.updatedAt - a.updatedAt),
    [source, local],
  );

  const importCount = desktopEntries.length;
  const resumePoints = desktopEntries.filter((entry) => entry.position > 0).length;

  const runImport = async () => {
    setImporting(true);
    setNotice(null);
    try {
      const { count } = await importHistory(desktopEntries);
      setImported(true);
      setNotice(`Imported ${count} titles · ${resumePoints} resume points`);
      try {
        setImportedEntries(await accountApi.history());
      } catch (err) {
        console.warn("[history] post-import refresh failed:", err);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const removeEntry = (entry: WatchEntry) => {
    void remove(entry.provider, entry.id, entry.season, entry.episode);
    clearProgress(entryKey(entry.provider as ProviderId, entry.id, entry.season, entry.episode));
    setLocal((prev) =>
      prev.filter(
        (row) =>
          row.provider !== entry.provider ||
          row.id !== entry.id ||
          row.season !== entry.season ||
          row.episode !== entry.episode,
      ),
    );
    setImportedEntries((prev) =>
      prev
        ? prev.filter(
            (row) =>
              row.provider !== entry.provider ||
              row.id !== entry.id ||
              row.season !== entry.season ||
              row.episode !== entry.episode,
          )
        : prev,
    );
  };

  return (
    <div className="page-shell pb-28 pt-28 md:pt-36">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <h1 className="display-title text-[clamp(2.2rem,4vw,3.2rem)]">History</h1>
        {ready && sorted.length > 0 && <span className="chip mb-1.5">{sorted.length} titles</span>}
      </div>
      {status === "authed" && (
        <p className="mt-3 text-zinc-400">Your watch progress is stored on your account and syncs across devices.</p>
      )}

      {status === "authed" && importCount > 0 && (
        <section className="glass mt-8 rounded-3xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <p className="font-semibold text-white">Bring in your desktop library</p>
              <p className="mt-1 text-sm text-zinc-400">
                We found {importCount} {importCount === 1 ? "title" : "titles"} from the Archlast Cine desktop client
                on this machine.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={importing || imported}
              className="btn-solid px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {imported ? "Imported ✓" : importing ? "Importing…" : `Import ${importCount} ${importCount === 1 ? "title" : "titles"}`}
            </button>
          </div>
          {notice && (
            <p className="mt-3 text-sm text-zinc-400" role="status" aria-live="polite">
              {notice}
            </p>
          )}
        </section>
      )}

      {!ready ? (
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="skeleton aspect-video w-full rounded-2xl" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="glass mx-auto mt-14 max-w-xl rounded-3xl px-8 py-16 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-brand-hover ring-1 ring-brand/40">
            <ClockIcon width={28} height={28} />
          </span>
          <h2 className="section-title mt-6 text-2xl">Nothing watched yet</h2>
          <p className="mt-2 text-sm text-zinc-400">Press play on something — it will show up here so you can jump back in.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/" className="btn-solid px-7 py-3 text-sm">
              Find something to watch
            </Link>
            {status === "anon" && (
              <Link href="/login" className="btn-glass px-7 py-3 text-sm">
                Sign in to sync
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-12 grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>div]:!w-full">
          {sorted.map((entry) => (
            <ContinueCard
              key={`${entry.provider}:${entry.id}:${entry.season}:${entry.episode}`}
              entry={entry}
              onRemove={() => removeEntry(entry)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
