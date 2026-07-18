import Link from "next/link";

/** Shown when the server-side basket has timed out (API 410). */
export function ExpiredNotice() {
  return (
    <div className="mx-auto max-w-lg px-5 py-20">
      <div className="rounded-lg bg-mist border border-line px-6 py-10 text-center">
        <p className="font-display text-2xl font-bold text-ink">
          Your booking session has expired
        </p>
        <p className="mt-2 text-sm text-foreground/70">
          Lodges are held for a limited time while you book. Start a fresh search
          and your dates will still be there.
        </p>
        <Link href="/" className="btn-primary mt-6">
          Back to search
        </Link>
      </div>
    </div>
  );
}
