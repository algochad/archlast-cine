"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";

const INPUT =
  "mono-meta w-full rounded-md border border-line bg-black/30 px-3.5 py-3 text-sm text-white placeholder-zinc-600 outline-none transition duration-150 focus:border-brand/50 focus:shadow-[0_0_0_3px_rgba(34,197,94,0.1)] disabled:opacity-60";
const LABEL = "mono-meta mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500";

const MIN_PASSWORD = 8;

export default function SignupPage() {
  const router = useRouter();
  const { status, register } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill from ?email= (e.g. arriving from a sign-in prompt).
  useEffect(() => {
    const invited = new URLSearchParams(window.location.search).get("email");
    if (invited) setEmail(invited);
  }, []);

  useEffect(() => {
    if (status === "authed") router.replace("/");
  }, [status, router]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setError("Tell us what to call you.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError("That email address doesn't look right.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      await register(trimmedName, trimmedEmail, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[460px] flex-col justify-center px-5 pb-24 pt-28">
      <p className="eyebrow">// Archlast Cine · Account</p>
      <h1 className="display-title mt-3 text-4xl">Create your Archlast Cine account</h1>
      <p className="mt-3 text-sm text-zinc-400">
        One account syncs your list and watch progress everywhere.
      </p>

      <form onSubmit={onSubmit} className="glass-panel mt-8 rounded-lg p-6">
        <div>
          <label className={LABEL} htmlFor="signup-name">
            Name
          </label>
          <input
            id="signup-name"
            type="text"
            autoComplete="name"
            required
            disabled={busy}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada Lovelace"
            className={INPUT}
          />
        </div>
        <div className="mt-5">
          <label className={LABEL} htmlFor="signup-email">
            Email
          </label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            disabled={busy}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className={INPUT}
          />
        </div>
        <div className="mt-5">
          <label className={LABEL} htmlFor="signup-password">
            Password
          </label>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={`at least ${MIN_PASSWORD} characters`}
            className={INPUT}
          />
        </div>

        {error && <p className="mono-meta mt-5 text-[11px] text-zinc-400">// {error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="btn-solid mono-meta mt-6 w-full px-5 py-3 text-[12px] font-bold uppercase tracking-[0.16em] disabled:cursor-default disabled:opacity-60"
        >
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
        Already joined?{" "}
        <Link href="/login" className="text-brand transition hover:text-brand-hover">
          Sign in
        </Link>
      </p>
    </div>
  );
}
