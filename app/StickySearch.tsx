"use client";

import { useEffect, useState } from "react";

/**
 * The sticky search reveal. Watches the #search media band and, once it has
 * scrolled up out of view, shows a fixed olive band at the bottom of the
 * viewport with a compact button that jumps back to the booking bar.
 */
export function StickySearch() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const band = document.getElementById("search");
    if (!band) return;
    const observer = new IntersectionObserver(([entry]) => {
      // Only reveal when the band has been scrolled past, not while it is
      // still below the fold on first load.
      setShow(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(band);
    return () => observer.disconnect();
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-olive shadow-[0_-2px_12px_rgba(0,0,0,0.2)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <p className="hidden text-sm font-semibold text-white sm:block">
          Unity Parks Naivasha, Lake Naivasha. Breaks start Friday or Monday.
        </p>
        <a href="#search" className="btn-primary inline-flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          Find your break
        </a>
      </div>
    </div>
  );
}
