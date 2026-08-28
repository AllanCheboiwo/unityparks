import "server-only";
import type { BookingRecord, BookingSession, User } from "@prisma/client";
import { PublicError } from "../api-helpers";

/**
 * Who may see or change a booking:
 *  - the signed-in account that owns it,
 *  - the browser that just paid for it (knows the unguessable session id).
 *
 * The reference + lead-email challenge used to be a third door, kept because
 * a guest could book without an account. Accounts are mandatory now
 * (UNP-19), so knowing a lead email proves nothing: possession of an address
 * is not possession of the account. Password reset, not a weaker door, is
 * how someone locked out gets back in.
 *
 * 401 means "no proof offered, ask for one" - the UI sends them to sign in.
 * 404 means "proof offered and wrong" - never confirm to a stranger that the
 * reference exists. A signed-in cookie that simply does not own the record
 * counts as no proof, not a wrong guess.
 */
export function assertBookingAccess(
  record: BookingRecord & { session: BookingSession },
  // `email` is accepted and ignored on purpose: confirmation and reminder
  // emails already in inboxes carry ?email=, and a stale link should be a
  // no-op rather than a crash. It grants nothing.
  proof: { user: User | null; sessionId: string | null; email?: string | null },
): void {
  if (proof.user && record.userId === proof.user.id) return;
  if (proof.sessionId) {
    if (record.sessionId === proof.sessionId) return;
    throw new PublicError(404, "Booking not found.");
  }
  throw new PublicError(401, "Please sign in to view your booking.");
}
