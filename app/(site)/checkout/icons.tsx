/** Tiny stroke-currentColor icons shared by the checkout steps. */

export function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" className="w-4 h-4 shrink-0 mt-0.5" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

export function TickIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" aria-hidden>
      <path
        d="M2.5 6.5 5 9l4.5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" className="w-5 h-5 shrink-0" fill="none" aria-hidden>
      <path
        d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg viewBox="0 0 20 20" className="w-5 h-5 shrink-0" fill="none" aria-hidden>
      <path
        d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m4 16 12-12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
