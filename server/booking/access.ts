import "server-only";
import type { BookingInvite, BookingRecord, BookingSession, User } from "@prisma/client";
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
  // `email` is accepted and ignored on purpose, and the frozen UNP-19 suite
  // pins that a passed email grants nothing (access.test.ts). Do not wire it
  // back up as a proof, and do not delete it either: the pinned tests must
  // stay expressible.
  proof: { user: User | null; sessionId: string | null; email?: string | null },
): void {
  if (proof.user && record.userId === proof.user.id) return;
  if (proof.sessionId) {
    if (record.sessionId === proof.sessionId) return;
    throw new PublicError(404, "Booking not found.");
  }
  throw new PublicError(401, "Please sign in to view your booking.");
}

/**
 * Like assertBookingAccess, but answers WHO is looking: the owner (account
 * or paying browser), or an accepted invitee (UNP-20). The invitee role is
 * derived from the invite rows alone - accepted by this user, not revoked,
 * booking not cancelled - never from the invitedUserId mirror. Read-only
 * callers (the booking GET, the manage page) ask for the role; every
 * mutating route keeps calling assertBookingAccess above, which does not
 * know invitees exist, so writing stays owner-only by construction.
 */
export function resolveBookingAccess(
  record: BookingRecord & {
    session: BookingSession;
    invites: Array<Pick<BookingInvite, "acceptedByUserId" | "revokedAt">>;
  },
  proof: { user: User | null; sessionId: string | null },
): { role: "owner" | "invitee" } {
  if (proof.user && record.userId === proof.user.id) return { role: "owner" };
  if (
    proof.user &&
    record.cancelledAt === null &&
    record.invites.some(
      (invite) =>
        invite.revokedAt === null &&
        invite.acceptedByUserId === proof.user!.id,
    )
  ) {
    return { role: "invitee" };
  }
  if (proof.sessionId) {
    if (record.sessionId === proof.sessionId) return { role: "owner" };
    throw new PublicError(404, "Booking not found.");
  }
  throw new PublicError(401, "Please sign in to view your booking.");
}
