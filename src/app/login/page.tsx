"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";

const INPUT =
  "mono-meta w-full rounded-md border border-line bg-black/30 px-3.5 py-3 text-sm text-white placeholder-zinc-600 outline-none transition duration-150 focus:border-brand/50 focus:shadow-[0_0_0_3px_rgba(34,197,94,0.1)] disabled:opacity-60";
const LABEL = "mono-meta mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500";

export default function LoginPage() {
  const router = useRouter();
  const { status, login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authed") router.replace("/");
  }, [status, router]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[460px] flex-col justify-center px-5 pb-24 pt-28">
      <p className="eyebrow">// Archlast Cine · Account</p>
      <h1 className="display-title mt-3 text-4xl">Sign in to Archlast Cine</h1>
      <p className="mt-3 text-sm text-zinc-400">
        Your watch history and list follow you across devices.
      </p>

      <form onSubmit={onSubmit} className="glass-panel mt-8 rounded-lg p-6">
        <div>
          <label className={LABEL} htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
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
          <label className={LABEL} htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            className={INPUT}
          />
        </div>

        {error && <p className="mono-meta mt-5 text-[11px] text-zinc-400">// {error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="btn-solid mono-meta mt-6 w-full px-5 py-3 text-[12px] font-bold uppercase tracking-[0.16em] disabled:cursor-default disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
        No account?{" "}
        <Link href="/signup" className="text-brand transition hover:text-brand-hover">
          Join
        </Link>
      </p>
    </div>
  );
}
