import "server-only";
import type { BookingRecord, BookingSession, User } from "@prisma/client";
import { PublicError } from "../api-helpers";
import { normalizeEmail } from "../auth/normalize";

/**
 * Who may see or change a booking:
 *  - the signed-in account that owns it,
 *  - the browser that just paid for it (knows the unguessable session id),
 *  - anyone who answers the reference + lead-email challenge (the airline
 *    fallback; deliberately weaker, kept so a guest with no account and no
 *    URL is never locked out - password reset is not part of the demo).
 *
 * 401 means "no proof offered, ask for one" - the UI shows the find-my-
 * booking prompt. 404 means "proof offered and wrong" - never confirm to a
 * stranger that the reference exists. A signed-in cookie that simply does
 * not own the record counts as no proof, not a wrong guess.
 */
export function assertBookingAccess(
  record: BookingRecord & { session: BookingSession },
  proof: { user: User | null; sessionId: string | null; email: string | null },
): void {
  if (proof.user && record.userId === proof.user.id) return;
  if (proof.email) {
    if (
      record.session.guestEmail !== null &&
      normalizeEmail(proof.email) === record.session.guestEmail.toLowerCase()
    ) {
      return;
    }
    throw new PublicError(404, "Booking not found.");
  }
  if (proof.sessionId) {
    if (record.sessionId === proof.sessionId) return;
    throw new PublicError(404, "Booking not found.");
  }
  throw new PublicError(401, "Please sign in or find your booking to view it.");
}
