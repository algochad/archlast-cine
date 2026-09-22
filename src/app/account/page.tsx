"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { accountApi } from "@/lib/api-account";
import { REGION_IDS, type RegionId } from "@/lib/account";
import { useSession } from "@/lib/session";

const INPUT =
  "mono-meta w-full rounded-md border border-line bg-black/30 px-3.5 py-3 text-sm text-white placeholder-zinc-600 outline-none transition duration-150 focus:border-brand/50 focus:shadow-[0_0_0_3px_rgba(34,197,94,0.1)] disabled:opacity-60";
const LABEL = "mono-meta mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500";

const PROVIDERS: { id: string; label: string }[] = [
  { id: "moviebox", label: "MovieBox" },
  { id: "fourkhdhub", label: "4KHDHub" },
];

export default function AccountPage() {
  const router = useRouter();
  const { status, user, settings, updateSettings, refresh, logout } = useSession();
  const [name, setName] = useState("");
  const [availableRegions, setAvailableRegions] = useState<RegionId[]>(["ph"]);
  const [region, setRegion] = useState<string>(settings.region);
  const [provider, setProvider] = useState<string>(settings.provider);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  useEffect(() => {
    setRegion(settings.region);
    setProvider(settings.provider);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await accountApi.config();
        if (!cancelled && config.availableRegions.length > 0) setAvailableRegions(config.availableRegions);
      } catch {
        /* keep the local default pool */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    setNotice(null);
    setError(null);
    if (!trimmed) {
      setError("Name can't be empty.");
      return;
    }
    setBusy(true);
    try {
      await accountApi.updateName(trimmed);
      await refresh();
      setNotice("// Name updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your name.");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setNotice(null);
    setError(null);
    setBusy(true);
    try {
      await updateSettings({ region, provider });
      setNotice("// Settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your settings.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="mx-auto w-full max-w-[720px] px-5 pb-28 pt-28">
        <div className="skeleton h-8 w-48 rounded-md" />
        <div className="skeleton mt-6 h-64 rounded-lg" />
      </div>
    );
  }

  if (status !== "authed" || !user) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-[460px] flex-col justify-center px-5 pb-24 pt-28 text-center">
        <p className="eyebrow">// Archlast Cine · Account</p>
        <h1 className="display-title mt-3 text-4xl">Sign in</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Settings and sync live behind an account.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/login" className="btn-glass mono-meta px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em]">
            Sign in
          </Link>
          <Link href="/signup" className="btn-solid mono-meta px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em]">
            Join
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-28 pt-28 md:px-8">
      <p className="eyebrow">// Archlast Cine · Account</p>
      <h1 className="display-title mt-3 text-4xl">Settings</h1>
      <p className="mono-meta mt-2 text-[11px] text-zinc-500">{user.email}</p>

      {notice && <p className="mono-meta mt-6 text-[11px] text-brand">{notice}</p>}
      {error && <p className="mono-meta mt-6 text-[11px] text-zinc-400">// {error}</p>}

      <form onSubmit={saveName} className="glass-panel mt-8 rounded-lg p-6">
        <h2 className="mono-meta text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-500">
          Profile
        </h2>
        <div className="mt-4">
          <label className={LABEL} htmlFor="account-name">
            Name
          </label>
          <input
            id="account-name"
            type="text"
            autoComplete="name"
            disabled={busy}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={INPUT}
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="btn-solid mono-meta mt-5 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] disabled:cursor-default disabled:opacity-60"
        >
          Save name
        </button>
      </form>

      <form onSubmit={saveSettings} className="glass-panel mt-6 rounded-lg p-6">
        <h2 className="mono-meta text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-500">
          Playback
        </h2>
        <div className="mt-4">
          <label className={LABEL} htmlFor="account-region">
            Region
          </label>
          <select
            id="account-region"
            disabled={busy}
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            className={INPUT}
          >
            {REGION_IDS.map((id) => {
              // Active region stays selectable even when its pool is not deployed.
              const unavailable = !availableRegions.includes(id) && id !== region;
              return (
                <option key={id} value={id} disabled={unavailable}>
                  {id.toUpperCase()}
                  {unavailable ? " — deploy region pool" : ""}
                </option>
              );
            })}
          </select>
        </div>
        <div className="mt-5">
          <label className={LABEL} htmlFor="account-provider">
            Default provider
          </label>
          <select
            id="account-provider"
            disabled={busy}
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className={INPUT}
          >
            {PROVIDERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="btn-solid mono-meta mt-5 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] disabled:cursor-default disabled:opacity-60"
        >
          Save settings
        </button>
      </form>

      <div className="hairline-t mt-8 flex items-center justify-between gap-4 pt-6">
        <p className="mono-meta text-[11px] uppercase tracking-[0.16em] text-zinc-500">
          Signed in as {user.name}
        </p>
        <button
          type="button"
          onClick={() => void logout().then(() => router.replace("/"))}
          className="mono-meta rounded-md border border-line px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-300 transition duration-150 hover:border-zinc-400/60 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
