import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Nav } from "@/components/nav";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Archlast Cine — stream cinema in the dark",
    template: "%s · Archlast Cine",
  },
  description:
    "Archlast Cine is a self-hosted streaming app: browse and watch movies and series through your own Rust media backend, with accounts that sync your list and watch progress across devices.",
  icons: {
    icon: [{ url: "/logo.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0c0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen bg-ink font-sans text-[#f2f2f2] antialiased">
        <SessionProvider>
          <Nav />
          <main className="min-h-screen">{children}</main>
          <footer className="mt-24 border-t border-line">
            <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-5 py-14 md:px-10">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
                <span className="text-brand">Archlast Cine</span>
                <span className="mx-2 text-zinc-700">//</span>
                <span className="text-zinc-400">Self-hosted streaming</span>
              </p>
              <p className="max-w-2xl text-xs leading-relaxed text-zinc-600">
                An independent client for publicly available streams. This project does not host or
                store any media, and streams are resolved from third-party sources. Users are
                responsible for complying with the laws of their country.
              </p>
            </div>
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
