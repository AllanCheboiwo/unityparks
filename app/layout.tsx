import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { SignOutButton } from "@/components/SignOutButton";
import "./globals.css";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Unity Parks | Forest & Lake Breaks",
  description:
    "Self-contained lodges in a lakeside forest village near Naivasha. Breaks start on a Friday or Monday.",
};

function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 group">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <circle cx="17" cy="17" r="16" fill="#1e3a29" />
        <path d="M17 6 L24 18 H20.5 L26 26 H8 L13.5 18 H10 Z" fill="#faf8f3" />
        <path d="M8 26 H26" stroke="#0e7490" strokeWidth="2.5" />
      </svg>
      <span className="font-display text-xl tracking-tight text-forest group-hover:text-forest-light transition-colors">
        Unity Parks
      </span>
    </Link>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading the cookie here makes every route dynamic. Fine for this app:
  // the pages are client-fetch shells anyway, and it keeps the header honest
  // on every navigation.
  const user = await getCurrentUser();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-forest/10 bg-background/90 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto max-w-5xl px-5 py-3.5 flex items-center justify-between">
            <BrandMark />
            <nav className="flex items-center gap-4">
              <span className="text-xs text-foreground/60 hidden lg:block">
                Lake Naivasha, Kenya · Breaks start on a Friday or Monday
              </span>
              <Link
                href="/account"
                className="text-sm font-medium text-forest hover:text-forest-light"
              >
                My booking
              </Link>
              {user ? (
                <span className="flex items-center gap-2 rounded-full bg-forest/5 ring-1 ring-forest/15 pl-3 pr-2 py-1">
                  <span className="text-sm font-medium text-forest">{user.firstName}</span>
                  <SignOutButton />
                </span>
              ) : (
                <Link
                  href="/login"
                  className="rounded-full border border-forest/25 px-4 py-1.5 text-sm font-medium text-forest hover:bg-forest/5"
                >
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-forest/10 mt-16">
          <div className="mx-auto max-w-5xl px-5 py-8 text-xs text-foreground/50 flex flex-wrap gap-x-6 gap-y-2 justify-between">
            <span>© {new Date().getFullYear()} Unity Parks Ltd · demo environment, no real payments.</span>
            <span>Powered by the Unity Parks booking engine on Apaleo.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
