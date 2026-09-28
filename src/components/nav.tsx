"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { PlayIcon, SearchIcon } from "@/components/icons";
import { useSession } from "@/lib/session";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Search" },
];

const ACCOUNT_LINKS = [
  { href: "/mylist", label: "My List" },
  { href: "/history", label: "History" },
  { href: "/account", label: "Settings" },
];

const MENU_ITEM =
  "block w-full px-4 py-2 text-left text-[13px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/5 hover:text-white";

/** Dismiss on outside pointer press or Escape while the menu is open. */
function useDismissable(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
}

function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onSignOut} className={`${MENU_ITEM} text-zinc-400`}>
      Sign out
    </button>
  );
}

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, status, logout } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  useDismissable(menuOpen, menuRef, () => setMenuOpen(false));
  useDismissable(mobileOpen, mobileRef, () => setMobileOpen(false));

  const immersive = pathname.startsWith("/watch");
  if (immersive) return null;

  const initial = (user?.name.trim().charAt(0) || user?.email.charAt(0) || "?").toUpperCase();

  const signOut = () => {
    setMenuOpen(false);
    setMobileOpen(false);
    void logout().then(() => router.replace("/"));
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color] duration-150 ${
        scrolled
          ? "border-line bg-ink/85 backdrop-blur-md"
          : "border-transparent bg-gradient-to-b from-black/70 to-transparent"
      }`}
    >
      <nav className="mx-auto flex h-14 max-w-[1500px] items-center gap-6 px-5 md:h-16 md:px-10">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5"
          aria-label="Archlast Cine home"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand shadow-[0_0_16px_rgba(34,197,94,0.35)] transition duration-150 group-hover:bg-brand-hover group-hover:shadow-[0_0_22px_rgba(74,222,128,0.55)]">
            <PlayIcon width={13} height={13} className="translate-x-px text-black" />
          </span>
          <span className="flex items-center font-display text-[17px] font-extrabold lowercase tracking-tight text-white">
            archlast<span className="text-brand">cine</span>
            <span aria-hidden="true" className="mb-0.5 ml-1 inline-block h-1.5 w-1.5 rounded-[2px] bg-brand" />
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`relative px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-150 after:absolute after:inset-x-3 after:-bottom-1 after:h-px after:bg-brand after:content-[''] ${
                  active ? "text-brand" : "text-zinc-400 after:opacity-0 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/search"
            aria-label="Search"
            className="grid h-9 w-9 place-items-center rounded-md border border-line text-zinc-200 transition-colors duration-150 hover:border-brand hover:text-white"
          >
            <SearchIcon width={17} height={17} />
          </Link>

          {/* ---------- Account cluster (desktop) ---------- */}
          <div ref={menuRef} className="relative hidden md:block">
            {status === "loading" ? (
              <span
                aria-hidden="true"
                className="block h-9 w-9 animate-pulse rounded-full border border-line bg-white/5"
              />
            ) : status === "authed" ? (
              <>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={`Account menu for ${user?.name ?? user?.email ?? ""}`}
                  onClick={() => setMenuOpen((open) => !open)}
                  className="grid h-9 w-9 place-items-center rounded-full bg-brand font-display text-sm font-bold text-black ring-1 ring-black/40 transition duration-150 hover:bg-brand-hover hover:shadow-[0_0_18px_rgba(74,222,128,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  {initial}
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label="Account"
                    className="glass-panel animate-fade-in absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg shadow-[0_18px_50px_rgba(0,0,0,0.7)]"
                  >
                    <div className="hairline-b px-4 py-3">
                      <p className="truncate text-sm font-semibold text-white">{user?.name}</p>
                      <p className="mono-meta truncate text-[11px] text-zinc-500">{user?.email}</p>
                    </div>
                    <div className="py-1">
                      {ACCOUNT_LINKS.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          role="menuitem"
                          onClick={() => setMenuOpen(false)}
                          className={MENU_ITEM}
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>
                    <div className="hairline-t py-1">
                      <SignOutButton onSignOut={signOut} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="btn-glass mono-meta px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.14em]"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="btn-solid mono-meta ml-3 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.14em]"
                >
                  Join
                </Link>
              </>
            )}
          </div>

          {/* ---------- Hamburger (mobile) ---------- */}
          <div ref={mobileRef} className="relative md:hidden">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={mobileOpen}
              aria-label="Menu"
              onClick={() => setMobileOpen((open) => !open)}
              className="grid h-9 w-9 place-items-center rounded-md border border-line text-zinc-200 transition-colors duration-150 hover:border-brand hover:text-white"
            >
              <span aria-hidden="true" className="flex flex-col gap-[3px]">
                <span className="block h-[1.5px] w-4 rounded-full bg-current" />
                <span className="block h-[1.5px] w-4 rounded-full bg-current" />
                <span className="block h-[1.5px] w-3 rounded-full bg-current" />
              </span>
            </button>
            {mobileOpen && (
              <div
                role="menu"
                aria-label="Menu"
                className="glass-panel animate-fade-in absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-lg shadow-[0_18px_50px_rgba(0,0,0,0.7)]"
              >
                <div className="py-1">
                  {LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      role="menuitem"
                      onClick={() => setMobileOpen(false)}
                      className={MENU_ITEM}
                    >
                      {link.label}
                    </Link>
                  ))}
                  {status === "authed" && (
                    <>
                      {ACCOUNT_LINKS.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          role="menuitem"
                          onClick={() => setMobileOpen(false)}
                          className={MENU_ITEM}
                        >
                          {link.label}
                        </Link>
                      ))}
                    </>
                  )}
                </div>
                <div className="hairline-t py-1">
                  {status === "authed" ? (
                    <>
                      <p className="truncate px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        {user?.email}
                      </p>
                      <SignOutButton onSignOut={signOut} />
                    </>
                  ) : (
                    <>
                      <Link
                        href="/login"
                        role="menuitem"
                        onClick={() => setMobileOpen(false)}
                        className={MENU_ITEM}
                      >
                        Sign in
                      </Link>
                      <Link
                        href="/signup"
                        role="menuitem"
                        onClick={() => setMobileOpen(false)}
                        className={MENU_ITEM}
                      >
                        Join
                      </Link>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
