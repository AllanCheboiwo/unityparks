import type { Metadata } from "next";
import { Fira_Sans, Open_Sans } from "next/font/google";
import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { SignOutButton } from "@/components/SignOutButton";
import "./globals.css";

// Fira Sans is the display face per docs/DESIGN.md: humanist, slightly warm,
// with a light weight for the big display headings.
const display = Fira_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
  style: ["normal", "italic"],
});

const body = Open_Sans({
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
    <Link href="/" className="flex items-center gap-2.5 group shrink-0">
      <svg width="38" height="38" viewBox="0 0 34 34" aria-hidden="true">
        <circle cx="17" cy="17" r="16" fill="#536917" />
        <path d="M17 6 L24 18 H20.5 L26 26 H8 L13.5 18 H10 Z" fill="#ffffff" />
        <path d="M8 26 H26" stroke="#2c5670" strokeWidth="2.5" />
      </svg>
      <span className="font-display font-semibold text-2xl tracking-tight text-olive group-hover:text-olive-light transition-colors">
        Unity Parks
      </span>
    </Link>
  );
}

const NAV = [
  { href: "/#discover", label: "Discover Unity Parks" },
  { href: "/#lodges", label: "Lodges" },
  { href: "/#things-to-do", label: "Things to do" },
  { href: "/account", label: "My booking" },
] as const;

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
        {/* White header: brand row with the sign-in button
            on the right, bold olive nav links underneath. */}
        <header className="bg-white">
          <div className="mx-auto max-w-7xl px-5 pt-4 pb-1 flex items-start justify-between gap-4">
            <BrandMark />
            <div className="flex flex-col items-end gap-2">
              {user ? (
                <span className="flex items-center gap-2 rounded-md border border-bronze pl-3 pr-2 py-1.5">
                  <span className="text-sm font-semibold text-bronze">{user.firstName}</span>
                  <SignOutButton />
                </span>
              ) : (
                <Link href="/login" className="btn-outline text-sm">
                  Sign in / Register
                </Link>
              )}
              <span className="text-sm text-foreground/70 hidden sm:block">
                Lake Naivasha, Kenya
              </span>
            </div>
          </div>
          <nav className="mx-auto max-w-7xl px-5 pb-3 flex items-center gap-7 overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap text-[16px] font-bold text-olive-soft hover:text-olive transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        {/* Teal info banner, the site-wide notice stripe. */}
        <div className="bg-teal text-white">
          <div className="mx-auto max-w-7xl px-5 py-3 flex items-center gap-3 text-[15px]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 8h.01M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <p>
              Breaks available to book up to 100 days ahead.{" "}
              <Link href="/#search" className="font-bold underline underline-offset-2">
                Secure your ideal dates and lodge today.
              </Link>
            </p>
          </div>
        </div>

        <main className="flex-1">{children}</main>

        {/* Dark footer: newsletter strip, link columns,
            social row, then the bottom bar with the memories line. */}
        <footer className="mt-16 bg-footer text-white">
          <div className="mx-auto max-w-7xl px-5 py-8 border-b border-white/15 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <p className="text-[15px] max-w-xl">
              Sign up for village news, seasonal openings and a first look at
              new lodges.
            </p>
            <form className="flex gap-2" action="#">
              <input
                type="email"
                placeholder="Email address"
                aria-label="Email address"
                className="rounded-md bg-white text-ink placeholder:text-foreground/50 px-3 py-2 text-sm w-56"
              />
              <button type="button" className="btn-primary text-sm" title="Demo only, not wired up yet">
                Sign up
              </button>
            </form>
          </div>

          <div className="mx-auto max-w-7xl px-5 py-10 grid gap-10 sm:grid-cols-3">
            <div>
              <p className="font-display text-xl font-bold mb-3">Unity Parks</p>
              <ul className="space-y-2.5 text-sm">
                <li><Link className="hover:text-moss" href="/#discover">Our village</Link></li>
                <li><Link className="hover:text-moss" href="/#lodges">Lodges</Link></li>
                <li><Link className="hover:text-moss" href="/#things-to-do">Things to do</Link></li>
                <li><Link className="hover:text-moss" href="/#faq">Questions and answers</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-display text-xl font-bold mb-3">Get in touch</p>
              <ul className="space-y-2.5 text-sm">
                <li><Link className="hover:text-moss" href="/manage">Find my booking</Link></li>
                <li><a className="hover:text-moss" href="tel:+254700000000">+254 700 000 000</a></li>
                <li><a className="hover:text-moss" href="mailto:hello@unityparks.example">hello@unityparks.example</a></li>
              </ul>
            </div>
            <div>
              <p className="font-display text-xl font-bold mb-3">Legal</p>
              <ul className="space-y-2.5 text-sm">
                <li><span className="text-white/70">Terms and conditions</span></li>
                <li><span className="text-white/70">Privacy policy</span></li>
                <li><span className="text-white/70">Cookies</span></li>
              </ul>
            </div>
          </div>

          <div className="bg-[#2b2b2b]">
            <div className="mx-auto max-w-7xl px-5 py-5 text-[13px] text-white/60 flex flex-wrap gap-x-6 gap-y-2 justify-between">
              <span>
                © {new Date().getFullYear()} Unity Parks Ltd · demo environment,
                no real payments.
              </span>
              <span>Counting our way to a billion memories.</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
