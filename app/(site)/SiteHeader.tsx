"use client";

import { useState } from "react";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { VILLAGE_LOCALE_LINE } from "@/content/village";

/**
 * The one-row site header: logo, nav, locale line, sign in, Book a break.
 * Client component only for the mobile drawer; everything else is static.
 *
 * Degrade order as the viewport narrows: locale line goes first, then the
 * sign-in button, then nav links trim from the right, and below md the nav
 * collapses into the hamburger drawer.
 */

const NAV = [
  { href: "/village", label: "Discover Unity Parks" },
  { href: "/#lodges", label: "Lodges" },
  { href: "/things-to-do", label: "Things to do" },
  { href: "/breaks", label: "Breaks" },
  { href: "/account", label: "My booking" },
] as const;

/** Trim nav links from the right as the row tightens. */
const NAV_VISIBILITY = [
  "",
  "",
  "hidden min-[860px]:block",
  "hidden min-[980px]:block",
  "hidden min-[1060px]:block",
] as const;

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 group shrink-0">
      <svg width={compact ? 30 : 34} height={compact ? 30 : 34} viewBox="0 0 34 34" aria-hidden="true">
        <circle cx="17" cy="17" r="16" fill="#536917" />
        <path d="M17 6 L24 18 H20.5 L26 26 H8 L13.5 18 H10 Z" fill="#ffffff" />
        <path d="M8 26 H26" stroke="#2c5670" strokeWidth="2.5" />
      </svg>
      <span className="font-display font-semibold text-lg sm:text-[22px] tracking-tight text-olive group-hover:text-olive-light transition-colors">
        Unity Parks
      </span>
    </Link>
  );
}

function PinIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function SiteHeader({ userFirstName }: { userFirstName: string | null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  return (
    <header className="bg-white border-b border-line">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-10 h-[66px] sm:h-[82px] flex items-center gap-6 lg:gap-11">
        <BrandMark />

        <nav className="hidden md:flex items-center gap-[30px] flex-1 min-w-0">
          {NAV.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap text-[15px] font-semibold text-olive-soft hover:text-olive transition-colors ${NAV_VISIBILITY[index]}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 sm:gap-[18px] shrink-0 ml-auto">
          <span className="hidden min-[1360px]:flex items-center gap-1.5 text-[13px] text-[#8a877f] whitespace-nowrap">
            <PinIcon />
            {VILLAGE_LOCALE_LINE}
          </span>
          {userFirstName ? (
            <span className="hidden min-[1140px]:flex items-center gap-2 rounded-md border border-bronze pl-3 pr-2 py-1.5">
              <span className="text-sm font-semibold text-bronze">{userFirstName}</span>
              <SignOutButton />
            </span>
          ) : (
            <Link
              href="/login"
              className="hidden min-[1140px]:inline-flex text-sm font-semibold text-bronze border border-bronze rounded-md px-4 py-2 whitespace-nowrap hover:bg-[#f7f3ec] transition-colors"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/#search"
            className="text-sm font-bold text-white bg-ochre rounded-md px-3.5 sm:px-[18px] py-[9px] whitespace-nowrap hover:bg-ochre-dark transition-colors"
          >
            Book a break
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="md:hidden flex items-center justify-center w-[42px] h-[42px] border border-line rounded-md bg-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1d1d1d" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col px-6 pt-5 pb-8 overflow-y-auto">
          <div className="flex items-center justify-between mb-7">
            <BrandMark compact />
            <button
              type="button"
              onClick={close}
              aria-label="Close menu"
              className="flex items-center justify-center w-[42px] h-[42px] border border-line rounded-md bg-white text-xl text-ink"
            >
              ×
            </button>
          </div>
          <nav className="flex flex-col">
            {NAV.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={`py-4 border-t border-line font-display text-xl font-semibold text-ink ${
                  index === NAV.length - 1 ? "border-b" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {userFirstName ? (
            <span className="mt-7 flex items-center justify-between gap-2 rounded-md border border-bronze px-4 py-3">
              <span className="text-sm font-semibold text-bronze">{userFirstName}</span>
              <SignOutButton />
            </span>
          ) : (
            <Link
              href="/login"
              onClick={close}
              className="mt-7 text-center text-base font-semibold text-bronze border border-bronze rounded-md py-3"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/#search"
            onClick={close}
            className="mt-3.5 bg-ochre text-white text-base font-bold rounded-md py-3.5 text-center hover:bg-ochre-dark"
          >
            Book a break
          </Link>
        </div>
      )}
    </header>
  );
}
