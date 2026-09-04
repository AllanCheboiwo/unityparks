// Acceptance-check fixture, not an ops tool. Shifts a paid booking's stay
// into the recent past so the repeat-guest offer window (UNP-7) can be
// exercised end to end on a deployed environment, where you cannot book
// dates that have already been and gone.
//
// The shift is a whole number of weeks, so arrival keeps its Friday or
// Monday turnover day, and any invites on the booking are backdated to the
// day before the new departure so they still satisfy the manifest rule
// (accepted membership counts only if the invite existed before departure).
//
// Run from the repo root against whichever database you are checking:
//   node scripts/force-past-departure.mjs JWUHFRLC
//   node scripts/force-past-departure.mjs JWUHFRLC --days 5
//
// --days is how far back the new departure should land (default 1, must
// stay inside the 31-day offer window). Re-running shifts again, so run it
// once per booking and read the printed dates.
import { PrismaClient } from "@prisma/client";

const reference = process.argv[2]?.trim();
const daysArg = process.argv.indexOf("--days");
const daysBack = daysArg === -1 ? 1 : Number(process.argv[daysArg + 1]);

if (!reference) {
  console.error("Usage: node scripts/force-past-departure.mjs <apaleoBookingId|recordId> [--days N]");
  process.exit(1);
}
if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 31) {
  console.error("--days must be a whole number from 1 to 31 (the offer window).");
  process.exit(1);
}

const DAY_MS = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

const prisma = new PrismaClient();
try {
  const record = await prisma.bookingRecord.findFirst({
    where: { OR: [{ apaleoBookingId: reference }, { id: reference }] },
    include: { session: true, invites: true },
  });
  if (!record) {
    console.error(`No booking matching ${reference}.`);
    process.exit(1);
  }
  if (record.status !== "paid") {
    console.error(`Booking ${reference} is ${record.status}, and the offer needs a settled stay.`);
    process.exit(1);
  }

  // Whole weeks, so a Friday stay stays a Friday stay.
  const departureMs = Date.parse(`${record.session.departure}T00:00:00Z`);
  const targetMs = Date.parse(`${iso(Date.now() - daysBack * DAY_MS)}T00:00:00Z`);
  const weeks = Math.ceil((departureMs - targetMs) / (7 * DAY_MS));
  if (weeks < 1) {
    console.error(`Departure ${record.session.departure} is already in the past. Nothing to do.`);
    process.exit(1);
  }
  const shiftMs = weeks * 7 * DAY_MS;
  const arrival = iso(Date.parse(`${record.session.arrival}T00:00:00Z`) - shiftMs);
  const departure = iso(departureMs - shiftMs);

  await prisma.bookingSession.update({
    where: { id: record.sessionId },
    data: { arrival, departure },
  });
  // The manifest rule reads invite creation against departure, so an invite
  // made today would fall outside a stay that now ended yesterday.
  const backdatedTo = new Date(Date.parse(`${departure}T00:00:00Z`) - DAY_MS);
  const backdated = await prisma.bookingInvite.updateMany({
    where: { recordId: record.id, createdAt: { gt: backdatedTo } },
    data: { createdAt: backdatedTo },
  });

  console.log(`Booking ${reference} (record ${record.id})`);
  console.log(`  stay  ${record.session.arrival} to ${record.session.departure}`);
  console.log(`     -> ${arrival} to ${departure} (back ${weeks} week${weeks === 1 ? "" : "s"})`);
  console.log(`  invites backdated to ${iso(backdatedTo.getTime())}: ${backdated.count}`);
} finally {
  await prisma.$disconnect();
}
