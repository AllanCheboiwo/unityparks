import "server-only";
import { prisma } from "../db";

/**
 * Adopt guest bookings whose lead email matches a newly registered or
 * signed-in account. Runs on every register and login.
 *
 * Emails are compared lowercased in JS, never via a Prisma filter, because
 * SQLite cannot compare case-insensitively and pre-backfill rows may still
 * be mixed case. Demo row counts make the table scan fine.
 *
 * Trust note: the email is unverified, so anyone registering with an email
 * someone else typed at checkout inherits those bookings. Acceptable for the
 * sandbox demo; production links only after email verification. claimedVia
 * records the adoption so a wrong link is visible and hand-reversible.
 */
export async function claimByEmail(userId: string, email: string): Promise<number> {
  // Records first - they are what My bookings lists.
  const records = await prisma.bookingRecord.findMany({
    where: { userId: null },
    include: { session: true },
  });
  const matching = records.filter(
    (r) => r.session.guestEmail?.toLowerCase() === email,
  );
  const now = new Date();
  for (const record of matching) {
    await prisma.bookingRecord.update({
      where: { id: record.id },
      data: { userId, claimedAt: now, claimedVia: "email-match" },
    });
  }

  // Sessions too, so a funnel walk that already submitted details (but has
  // not checked out yet) lands its record under this account at checkout.
  const sessions = await prisma.bookingSession.findMany({
    where: { userId: null, guestEmail: { not: null } },
  });
  const sessionIds = sessions
    .filter((s) => s.guestEmail?.toLowerCase() === email)
    .map((s) => s.id);
  if (sessionIds.length > 0) {
    await prisma.bookingSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { userId },
    });
  }

  return matching.length;
}
