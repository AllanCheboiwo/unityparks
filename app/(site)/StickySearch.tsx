"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keeps the booking bar on screen. The bar renders in its natural spot over
 * the media band; once that spot scrolls above the viewport, the bar locks
 * to the top of the screen in an olive band and stays there for the rest of
 * the page. A sentinel marks the natural spot so scrolling back up releases
 * the bar again.
 */
export function StickySearch({ children }: { children: React.ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    // A plain scroll check beats an IntersectionObserver here: the sentinel
    // has zero height, which observers handle inconsistently. No rAF
    // throttle either; the check is one getBoundingClientRect and React
    // ignores repeat setState calls with the same value.
    const onScroll = () => {
      setStuck(el.getBoundingClientRect().top < 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden />
      <div
        className={
          stuck
            ? "fixed inset-x-0 top-0 z-50 bg-olive py-2.5 shadow-[0_2px_12px_rgba(0,0,0,0.25)]"
            : ""
        }
      >
        <div className="mx-auto max-w-6xl px-5">{children}</div>
      </div>
    </>
  );
}
