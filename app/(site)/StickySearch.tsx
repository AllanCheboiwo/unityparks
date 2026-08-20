"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keeps the booking bar on screen. The bar's natural spot is riding the
 * bottom edge of the hero; once that spot scrolls out of view, the bar
 * itself pins near the top of the viewport, centred at its own width. A
 * sentinel marks the natural spot so scrolling back up releases the bar.
 *
 * Below lg the bar stacks into five rows, far too tall to pin, and it sits
 * in normal flow under the hero anyway, so pinning is suppressed entirely.
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
      // 1024 = Tailwind lg, the breakpoint where BookingBar stops stacking.
      const pinnable = window.innerWidth >= 1024;
      setStuck(pinnable && el.getBoundingClientRect().top < 44);
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
            ? "fixed top-3.5 left-1/2 -translate-x-1/2 z-50 w-[min(1160px,100vw-80px)]"
            : ""
        }
      >
        {children}
      </div>
    </>
  );
}
