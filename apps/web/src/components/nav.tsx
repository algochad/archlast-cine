"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BookmarkIcon,
  ClockIcon,
  FilmIcon,
  GearIcon,
  HomeIcon,
  LogoutIcon,
  SearchIcon,
  SparkleIcon,
  TvIcon,
} from "@/components/icons";
import { useDismissable } from "@/hooks/use-dismissable";
import { useMyList, useSession } from "@/lib/session";

const LINKS = [
  { href: "/", label: "Home", match: (p: string) => p === "/", Icon: HomeIcon },
  { href: "/browse/movies", label: "Movies", match: (p: string) => p.startsWith("/browse/movies"), Icon: FilmIcon },
  { href: "/browse/series", label: "Series", match: (p: string) => p.startsWith("/browse/series"), Icon: TvIcon },
  { href: "/browse/anime", label: "Anime", match: (p: string) => p.startsWith("/browse/anime"), Icon: SparkleIcon },
];

const MENU_ITEM =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.07] hover:text-white";

function Wordmark() {
  return (
    <span className="font-display text-[1.35rem] font-bold leading-none tracking-tight text-white">
      Archlast<span className="gradient-text">Cine</span>
    </span>
  );
}

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, status, logout } = useSession();
  const { items: listItems } = useMyList();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useDismissable(menuOpen, menuRef, () => setMenuOpen(false));

  // The player owns the whole screen.
  if (pathname.startsWith("/watch")) return null;

  const initial = (user?.name.trim().charAt(0) || user?.email.charAt(0) || "?").toUpperCase();
  const signOut = () => {
    setMenuOpen(false);
    void logout().then(() => router.replace("/"));
  };
  const onSearch = pathname.startsWith("/search");

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-[background-color,backdrop-filter] duration-300 ${
          scrolled ? "bg-ink/70 backdrop-blur-xl" : "bg-gradient-to-b from-ink/80 via-ink/30 to-transparent"
        }`}
      >
        <nav
          aria-label="Primary"
          className="page-shell flex h-[4.5rem] items-center gap-4 md:h-[5.25rem] md:gap-8"
        >
          <Link href="/" className="group flex shrink-0 items-center gap-3" aria-label="Archlast Cine home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.svg"
              alt=""
              width={40}
              height={40}
              className="h-9 w-9 rounded-[0.85rem] shadow-[0_8px_26px_rgba(34,197,94,0.45)] transition duration-300 group-hover:scale-105 group-hover:shadow-[0_8px_34px_rgba(34,197,94,0.7)] md:h-10 md:w-10"
            />
            <Wordmark />
          </Link>

          {/* Desktop pill */}
          <div className="hidden flex-1 md:flex md:justify-center">
            <ul className="flex items-center gap-1 rounded-full border border-line bg-surface/70 p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              {LINKS.map(({ href, label, match }) => {
                const active = match(pathname);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-full px-5 py-2 text-sm font-semibold transition duration-200 ${
                        active
                          ? "bg-white text-ink shadow-[0_4px_18px_rgba(255,255,255,0.18)]"
                          : "text-zinc-300 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link
                  href="/search"
                  aria-current={onSearch ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition duration-200 ${
                    onSearch ? "bg-white text-ink" : "text-zinc-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <SearchIcon width={16} height={16} />
                  Search
                </Link>
              </li>
            </ul>
          </div>

          <div className="ml-auto flex items-center gap-3 md:ml-0">
            <Link
              href="/search"
              aria-label="Search"
              className="btn-glass h-10 w-10 !rounded-full p-0 md:hidden"
            >
              <SearchIcon width={18} height={18} />
            </Link>

            <div ref={menuRef} className="relative">
              {status === "loading" ? (
                <span aria-hidden="true" className="block h-10 w-10 animate-pulse rounded-full bg-white/10" />
              ) : status === "authed" ? (
                <>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label={`Account menu for ${user?.name ?? user?.email ?? ""}`}
                    onClick={() => setMenuOpen((open) => !open)}
                    className="grid h-10 w-10 place-items-center rounded-full bg-[linear-gradient(135deg,#4ade80,#86efac)] font-display text-[15px] font-bold text-white shadow-[0_6px_22px_rgba(34,197,94,0.45)] ring-2 ring-white/20 transition duration-200 hover:scale-105"
                  >
                    {initial}
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      aria-label="Account"
                      className="glass animate-fade-in absolute right-0 top-full z-50 mt-3 w-72 overflow-hidden rounded-2xl bg-surface/95 p-2 shadow-[0_24px_70px_rgba(0,0,0,0.7)]"
                    >
                      <div className="flex items-center gap-3 px-3 py-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#4ade80,#86efac)] font-display text-base font-bold text-white">
                          {initial}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{user?.name}</p>
                          <p className="truncate text-xs text-zinc-500">{user?.email}</p>
                        </div>
                      </div>
                      <div className="my-1 h-px bg-line" />
                      <Link href="/mylist" role="menuitem" className={MENU_ITEM}>
                        <BookmarkIcon width={17} height={17} className="text-zinc-400" />
                        My List
                        {listItems.length > 0 && (
                          <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-zinc-300">
                            {listItems.length}
                          </span>
                        )}
                      </Link>
                      <Link href="/history" role="menuitem" className={MENU_ITEM}>
                        <ClockIcon width={17} height={17} className="text-zinc-400" />
                        History
                      </Link>
                      <Link href="/account" role="menuitem" className={MENU_ITEM}>
                        <GearIcon width={17} height={17} className="text-zinc-400" />
                        Settings
                      </Link>
                      <div className="my-1 h-px bg-line" />
                      <button type="button" role="menuitem" onClick={signOut} className={MENU_ITEM}>
                        <LogoutIcon width={17} height={17} className="text-zinc-400" />
                        Sign out
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Link href="/login" className="btn-glass px-5 py-2.5 text-sm">
                    Sign in
                  </Link>
                  <Link href="/signup" className="btn-solid hidden px-5 py-2.5 text-sm sm:inline-flex">
                    Join free
                  </Link>
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      {/* Mobile tab bar */}
      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-3 bottom-3 z-50 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-5 rounded-[1.6rem] border border-line-strong bg-surface/85 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
          {[
            ...LINKS,
            { href: "/mylist", label: "List", match: (p: string) => p.startsWith("/mylist"), Icon: BookmarkIcon },
          ].map(({ href, label, match, Icon }) => {
            const active = match(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-1 rounded-2xl py-2 text-[10.5px] font-semibold transition ${
                    active ? "bg-white/10 text-white" : "text-zinc-400"
                  }`}
                >
                  <Icon width={20} height={20} className={active ? "text-brand-hover" : ""} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
