import Link from "next/link";

/** Shown when the server-side basket has timed out (API 410). */
export function ExpiredNotice() {
  return (
    <div className="mx-auto max-w-lg text-center py-20 px-5">
      <p className="font-display text-2xl text-forest">Your booking session has expired</p>
      <p className="mt-2 text-sm text-foreground/60">
        Lodges are held for a limited time while you book. Start a fresh search
        and your dates will still be there.
      </p>
      <Link
        href="/"
        className="inline-block mt-6 rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light"
      >
        Back to search
      </Link>
    </div>
  );
}
