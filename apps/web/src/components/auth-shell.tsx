import Link from "next/link";
import type { ReactNode } from "react";
import { CcIcon, ClockIcon, SparkleIcon } from "@/components/icons";

const PERKS = [
  { Icon: ClockIcon, title: "Pick up where you left off", text: "Your progress follows you from phone to TV." },
  { Icon: CcIcon, title: "Subtitles in your language", text: "Choose once — we remember it everywhere." },
  { Icon: SparkleIcon, title: "One list for everything", text: "Movies, series and anime, together." },
];

/** Split-screen frame shared by sign-in and sign-up. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Showcase */}
      <aside className="relative hidden overflow-hidden lg:block" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_20%_15%,rgba(124,108,255,0.55),transparent_70%),radial-gradient(60%_55%_at_85%_80%,rgba(56,214,245,0.28),transparent_70%),linear-gradient(160deg,#0f1530,#060912)]" />
        <div className="absolute -right-24 top-24 h-80 w-80 rounded-full bg-brand/30 blur-[100px]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,#060912_0%,transparent_45%)]" />
        <div className="relative flex h-full flex-col justify-between p-14 pt-32">
          <div>
            <p className="eyebrow">Archlast Cine</p>
            <p className="display-title mt-5 max-w-lg text-[clamp(2.6rem,4.2vw,4rem)]">
              A little escape.
              <br />
              <span className="gradient-text">A great story.</span>
            </p>
          </div>
          <ul className="space-y-5">
            {PERKS.map(({ Icon, title: t, text }) => (
              <li key={t} className="glass flex items-start gap-4 rounded-2xl p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-hover ring-1 ring-brand/30">
                  <Icon width={20} height={20} />
                </span>
                <span>
                  <span className="block font-semibold text-white">{t}</span>
                  <span className="mt-0.5 block text-sm text-zinc-400">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Form */}
      <div className="flex flex-col justify-center px-6 pb-16 pt-28 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-[26rem]">
          <Link href="/" className="mb-8 inline-flex items-center gap-3 lg:hidden" aria-label="Archlast Cine home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={36} height={36} className="h-9 w-9" />
            <span className="font-display text-xl font-bold text-white">Archlast Cine</span>
          </Link>
          <h1 className="display-title text-[2.4rem]">{title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">{subtitle}</p>
          <div className="glass mt-8 rounded-3xl p-6 sm:p-8">{children}</div>
          <p className="mt-7 text-center text-sm text-zinc-400">{footer}</p>
        </div>
      </div>
    </div>
  );
}
