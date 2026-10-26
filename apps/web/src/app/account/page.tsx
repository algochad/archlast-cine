"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { REGION_IDS, type RegionId } from "@/lib/account";
import { accountApi } from "@/lib/api-account";
import { LANGUAGE_OPTIONS } from "@/lib/languages";
import { getPrefs, setPrefs, subscribePrefs, type PlayerPrefs } from "@/lib/player-prefs";
import { useSession } from "@/lib/session";

const REGION_NAMES: Record<RegionId, string> = {
  ph: "Philippines",
  us: "United States",
  in: "India",
  sg: "Singapore",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-3xl p-6 sm:p-8">
      <h2 className="section-title text-xl">{title}</h2>
      {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-6">
      <span>
        <span className="block text-[15px] font-semibold text-zinc-100">{label}</span>
        {hint && <span className="mt-0.5 block text-sm text-zinc-500">{hint}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="h-7 w-12 rounded-full bg-white/15 ring-1 ring-white/10 transition peer-checked:bg-brand peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-hover" />
        <span className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const { status, user, settings, updateSettings, refresh, logout } = useSession();
  const [name, setName] = useState("");
  const [availableRegions, setAvailableRegions] = useState<RegionId[]>(["ph"]);
  const [region, setRegion] = useState<string>(settings.region);
  const [prefs, setLocalPrefs] = useState<PlayerPrefs | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Playback preferences live in local storage and sync to the account when signed in.
  useEffect(() => {
    setLocalPrefs(getPrefs());
    return subscribePrefs(setLocalPrefs);
  }, []);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  useEffect(() => {
    setRegion(settings.region);
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

  const flash = (message: string) => {
    setError(null);
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 2400);
  };

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    setNotice(null);
    setError(null);
    if (!trimmed) {
      setError("Your name can’t be empty.");
      return;
    }
    setBusy(true);
    try {
      await accountApi.updateName(trimmed);
      if (region !== settings.region) await updateSettings({ region });
      await refresh();
      flash("Profile saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn’t save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const pref = (patch: Partial<PlayerPrefs>) => {
    setLocalPrefs(setPrefs(patch));
    flash("Preference saved");
  };

  const signedIn = status === "authed" && user;
  const subLang = prefs?.prefSubLang?.[0] ?? "en";
  const audioLang = prefs?.prefAudioLang?.[0] ?? "ja";

  return (
    <div className="page-shell max-w-[52rem] pb-28 pt-28 md:pt-36">
      <h1 className="display-title text-[clamp(2.2rem,4vw,3.2rem)]">Settings</h1>
      <p className="mt-2 text-zinc-400">{signedIn ? user.email : "Customize playback — sign in to sync it across devices."}</p>

      <div aria-live="polite" className="mt-5 min-h-6 text-sm">
        {notice && <span className="font-semibold text-brand-hover">✓ {notice}</span>}
        {error && <span className="text-rose">{error}</span>}
      </div>

      <div className="space-y-6">
        <Section title="Playback" description="How the player behaves for you.">
          <div>
            <label className="field-label" htmlFor="pref-sub">
              Preferred subtitle language
            </label>
            <select
              id="pref-sub"
              value={subLang}
              onChange={(e) => pref({ prefSubLang: [e.target.value, ...(prefs?.prefSubLang ?? []).filter((l) => l !== e.target.value)].slice(0, 3) })}
              className="field"
            >
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-zinc-500">We pick this track automatically whenever it’s available.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="pref-audio">
              Preferred audio language
            </label>
            <select
              id="pref-audio"
              value={audioLang}
              onChange={(e) => pref({ prefAudioLang: [e.target.value, ...(prefs?.prefAudioLang ?? []).filter((l) => l !== e.target.value)].slice(0, 3) })}
              className="field"
            >
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <Toggle
            label="Autoplay next episode"
            hint="Roll straight into the next episode when one ends."
            checked={prefs?.autoplay ?? true}
            onChange={(v) => pref({ autoplay: v })}
          />
          <Toggle
            label="Prefer captions for the hard of hearing"
            hint="Choose SDH subtitles (with sound descriptions) when a title has them."
            checked={prefs?.preferSDH ?? false}
            onChange={(v) => pref({ preferSDH: v })}
          />
        </Section>

        {signedIn ? (
          <form onSubmit={saveProfile}>
            <Section title="Profile">
              <div>
                <label className="field-label" htmlFor="account-name">
                  Display name
                </label>
                <input
                  id="account-name"
                  type="text"
                  autoComplete="name"
                  disabled={busy}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="account-region">
                  Region
                </label>
                <select
                  id="account-region"
                  disabled={busy}
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  className="field"
                >
                  {REGION_IDS.map((id) => {
                    // The active region stays selectable even if its pool isn't deployed.
                    const unavailable = !availableRegions.includes(id) && id !== region;
                    return (
                      <option key={id} value={id} disabled={unavailable}>
                        {REGION_NAMES[id]}
                        {unavailable ? " — unavailable" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <button type="submit" disabled={busy} className="btn-solid px-7 py-3 text-sm disabled:opacity-60">
                {busy ? "Saving…" : "Save profile"}
              </button>
            </Section>
          </form>
        ) : status === "anon" ? (
          <Section title="Your account" description="Create a free account to sync your list, history and preferences.">
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="btn-solid px-7 py-3 text-sm">
                Create account
              </Link>
              <Link href="/login" className="btn-glass px-7 py-3 text-sm">
                Sign in
              </Link>
            </div>
          </Section>
        ) : (
          <div className="skeleton h-48 rounded-3xl" />
        )}

        {signedIn && (
          <div className="flex items-center justify-between gap-4 border-t border-line pt-6">
            <p className="text-sm text-zinc-500">Signed in as {user.name}</p>
            <button type="button" onClick={() => void logout().then(() => router.replace("/"))} className="btn-glass px-6 py-2.5 text-sm">
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
