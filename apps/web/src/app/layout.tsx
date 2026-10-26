import type { Metadata, Viewport } from "next";
import { DM_Sans, Outfit } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

const body = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const heading = Outfit({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Archlast Cine — a little escape. A great story.",
    template: "%s · Archlast Cine",
  },
  description:
    "Archlast Cine: browse and watch movies, series and anime in one beautiful place — with subtitles in your language and a watch list that follows you across devices.",
  icons: {
    icon: [{ url: "/logo.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable}`}>
      <body className="min-h-screen bg-ink font-sans text-zinc-100 antialiased">
        <SessionProvider>
          <Nav />
          <main className="min-h-screen pb-24 md:pb-0">{children}</main>
          <footer className="mt-24 border-t border-line">
            <div className="page-shell flex flex-col gap-6 py-12 md:flex-row md:items-end md:justify-between">
              <div className="space-y-3">
                <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Archlast Cine home">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.svg" alt="" width={28} height={28} className="h-7 w-7" />
                  <span className="font-display text-lg font-bold tracking-tight text-white">Archlast Cine</span>
                </Link>
                <p className="max-w-xl text-xs leading-relaxed text-zinc-500">
                  An independent client for publicly available streams. It does not host or store any
                  media; streams are resolved from third-party sources. Please respect the laws of your
                  country.
                </p>
              </div>
              <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-400">
                <Link href="/" className="transition hover:text-white">Home</Link>
                <Link href="/search" className="transition hover:text-white">Search</Link>
                <Link href="/mylist" className="transition hover:text-white">My List</Link>
                <Link href="/history" className="transition hover:text-white">History</Link>
              </nav>
            </div>
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
