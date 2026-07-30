import Link from "next/link";

/** The pattern-18 breadcrumb shown at the top of every checkout step. */
export function CheckoutBreadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm">
      <ol className="flex items-center gap-2">
        <li>
          <Link href="/" className="text-olive hover:underline">
            Unity Parks
          </Link>
        </li>
        <li aria-hidden className="text-foreground/40">
          /
        </li>
        <li className="text-foreground/60">Checkout</li>
      </ol>
    </nav>
  );
}
