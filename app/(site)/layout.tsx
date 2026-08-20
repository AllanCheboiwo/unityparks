import type { Metadata } from "next";
import { Fira_Sans, Open_Sans } from "next/font/google";
import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { getSiteBanner } from "@/server/content";
import { NewsletterForm } from "@/components/NewsletterForm";
import { SiteHeader } from "./SiteHeader";
import "./globals.css";

// Fira Sans is the display face per docs/DESIGN.md: humanist, slightly warm,
// bold weights for the big display headings.
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
  title: "Unity Parks | Forest Breaks on Mount Kenya",
  description:
    "Self-contained lodges in a car-free forest village on the slopes of Mount Kenya. Breaks start on a Friday or Monday.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading the cookie here makes every route dynamic. Fine for this app:
  // the pages are client-fetch shells anyway, and it keeps the header honest
  // on every navigation.
  const user = await getCurrentUser();
  // The teal stripe is the campaign slot, editor-owned in the CMS. Null on
  // an unseeded database, in which case the fallback line below renders.
  const banner = await getSiteBanner();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-screen flex flex-col">
        {/* Teal info banner rides above the header: the site-wide notice stripe. */}
        <div className="bg-teal text-white">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-10 py-2.5 flex items-center gap-2.5 text-sm">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 8h.01M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <p>
              {banner ? (
                <>
                  {banner.text}{" "}
                  <Link
                    href={banner.linkHref}
                    className="font-bold underline underline-offset-2"
                  >
                    {banner.linkLabel}
                  </Link>
                </>
              ) : (
                <>
                  Breaks start on a Friday or a Monday.{" "}
                  <Link href="/#search" className="font-bold underline underline-offset-2">
                    Secure your dates and lodge
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>

        <SiteHeader userFirstName={user?.firstName ?? null} />

        <main className="flex-1">{children}</main>

        {/* Dark footer: newsletter strip, brand and link columns, then the
            bottom bar. */}
        <footer className="mt-16 bg-footer text-white">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-10">
            <div className="py-9 border-b border-white/15 flex flex-col sm:flex-row sm:items-center gap-5 justify-between">
              <p className="text-[15px] max-w-md">
                Sign up for village news, seasonal openings and a first look at
                new lodges.
              </p>
              <NewsletterForm />
            </div>

            <div className="py-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-11">
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <svg width="28" height="28" viewBox="0 0 34 34" aria-hidden="true">
                    <circle cx="17" cy="17" r="16" fill="#647e1b" />
                    <path d="M17 6 L24 18 H20.5 L26 26 H8 L13.5 18 H10 Z" fill="#ffffff" />
                    <path d="M8 26 H26" stroke="#333333" strokeWidth="2.5" />
                  </svg>
                  <span className="font-display font-semibold text-xl">Unity Parks</span>
                </div>
                <p className="text-sm leading-[1.75] text-white/70 max-w-[34ch]">
                  One car-free forest village at Naro Moru, on the slopes of
                  Mount Kenya. Breaks start every Friday and Monday.
                </p>
              </div>
              <div>
                <p className="font-display text-base font-semibold mb-4">Explore</p>
                <ul className="space-y-2.5 text-sm">
                  <li><Link className="text-white/75 hover:text-moss" href="/village">Our village</Link></li>
                  <li><Link className="text-white/75 hover:text-moss" href="/#lodges">Lodges</Link></li>
                  <li><Link className="text-white/75 hover:text-moss" href="/things-to-do">Things to do</Link></li>
                  <li><Link className="text-white/75 hover:text-moss" href="/breaks">Breaks</Link></li>
                  <li><Link className="text-white/75 hover:text-moss" href="/#faq">Questions and answers</Link></li>
                </ul>
              </div>
              <div>
                <p className="font-display text-base font-semibold mb-4">Get in touch</p>
                <ul className="space-y-2.5 text-sm">
                  <li><Link className="text-white/75 hover:text-moss" href="/manage">Find my booking</Link></li>
                  <li><a className="text-white/75 hover:text-moss" href="tel:+254700000000">+254 700 000 000</a></li>
                  <li><a className="text-white/75 hover:text-moss" href="mailto:hello@unityparks.example">hello@unityparks.example</a></li>
                </ul>
              </div>
              <div>
                <p className="font-display text-base font-semibold mb-4">Legal</p>
                <ul className="space-y-2.5 text-sm">
                  <li><Link className="text-white/60 hover:text-moss" href="/terms">Terms and conditions</Link></li>
                  <li><span className="text-white/60">Privacy policy</span></li>
                  <li><span className="text-white/60">Cookies</span></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-[#2b2b2b]">
            <div className="mx-auto max-w-[1240px] px-5 sm:px-10 py-5 text-[13px] text-white/55 flex flex-wrap gap-x-8 gap-y-2 justify-between">
              <span>
                © {new Date().getFullYear()} Unity Parks Ltd · demo environment,
                no real payments.
              </span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
