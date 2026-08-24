import { getCurrentUser } from "@/server/auth/session";
import { DetailsClient } from "./DetailsClient";

/**
 * No Suspense boundary here, deliberately, and that is a fix rather than an
 * oversight.
 *
 * With one, this step rendered as a permanently blank page. React outlined
 * the boundary's HTML into the trailing `<div hidden id="S:0">` and the
 * splice back into the document never happened, so the form sat complete but
 * invisible while its effects ran (Next 16.2 / React 19.2). The sibling
 * checkout pages keep their boundaries only because theirs never actually
 * suspend: their clients render a placeholder synchronously and fetch from
 * an effect, so there is nothing to outline.
 *
 * A boundary is not needed. useSearchParams only forces one on a route that
 * is statically prerendered, and this route is dynamic already: reading the
 * auth cookie below settles that. `next build` is the guard - it fails the
 * build if the boundary is ever genuinely required.
 */
export default async function DetailsPage() {
  const user = await getCurrentUser();
  return (
    <DetailsClient
      initialUser={
        user
          ? {
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              phone: user.phone ?? "",
              title: user.title ?? "",
              dateOfBirth: user.dateOfBirth ?? "",
              marketingEmail: user.marketingEmail,
              marketingSms: user.marketingSms,
            }
          : null
      }
    />
  );
}
