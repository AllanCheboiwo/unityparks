// One-time backfill: lowercase every stored guest email so SQLite's
// case-sensitive matching never silently misses. Safe to re-run; from now on
// setGuestDetails normalizes on write so new rows never need this.
// Run from the repo root: node scripts/normalize-guest-emails.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const sessions = await prisma.bookingSession.findMany({
  where: { guestEmail: { not: null } },
});

let changed = 0;
for (const session of sessions) {
  const normalized = session.guestEmail.trim().toLowerCase();
  if (normalized !== session.guestEmail) {
    await prisma.bookingSession.update({
      where: { id: session.id },
      data: { guestEmail: normalized },
    });
    changed++;
  }
}

console.log(`Checked ${sessions.length} sessions with a guest email, normalized ${changed}.`);
await prisma.$disconnect();
