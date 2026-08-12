import Link from "next/link";

/**
 * The site's 404. Without it, an unknown lodge code or a non-admin hitting
 * /ops renders Next's bare error page: no header, no footer, no styles,
 * because the root layout now lives inside this route group.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-5 py-20 text-center">
      <p className="font-display text-3xl font-bold text-ink">
        We couldn&apos;t find that page
      </p>
      <p className="mt-2 text-sm text-foreground">
        The link may be out of date, or the page may have moved. The lodges
        and your booking are both a click away.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="btn-primary">
          Back to the village
        </Link>
        <Link href="/#search" className="btn-dark-outline">
          Find a break
        </Link>
      </div>
    </div>
  );
}
