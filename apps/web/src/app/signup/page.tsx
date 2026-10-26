"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { useSession } from "@/lib/session";

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
      setError("That email address doesn’t look right.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Choose a password with at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      await register(trimmedName, trimmedEmail, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn’t create your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free forever. One account keeps your list and progress in sync everywhere."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand-hover transition hover:text-white">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div>
          <label className="field-label" htmlFor="signup-name">
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
            className="field"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="signup-email">
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
            className="field"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="signup-password">
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
            placeholder={`At least ${MIN_PASSWORD} characters`}
            className="field"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-rose/30 bg-rose/10 px-4 py-3 text-sm text-rose">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-solid w-full py-3.5 text-[15px] disabled:opacity-60">
          {busy ? "Creating your account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
