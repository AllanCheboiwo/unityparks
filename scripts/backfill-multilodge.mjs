// One-time backfill for the multi-lodge schema: every existing session gets
// a slot-0 SessionLodge mirroring its legacy single-lodge columns, and every
// existing BookingRecord gets a slot-0 BookingReservation carrying its
// payment state. Safe to re-run: rows that already have children are skipped.
// Run from the repo root: node scripts/backfill-multilodge.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const sessions = await prisma.bookingSession.findMany({
  include: { lodges: true, booking: true },
});
let lodgesCreated = 0;
for (const s of sessions) {
  if (s.lodges.length > 0) continue;
  await prisma.sessionLodge.create({
    data: {
      sessionId: s.id,
      slot: 0,
      adults: s.adults,
      childrenAges: s.childrenAges,
      unitGroupCode: s.unitGroupCode,
      ratePlanId: s.ratePlanId,
      stayGrossAmount: s.stayGrossAmount,
      extras: s.extras,
      apaleoReservationId: s.booking?.apaleoReservationId ?? null,
    },
  });
  lodgesCreated++;
}

const records = await prisma.bookingRecord.findMany({
  include: { reservations: true },
});
let reservationsCreated = 0;
for (const r of records) {
  if (r.reservations.length > 0) continue;
  await prisma.bookingReservation.create({
    data: {
      recordId: r.id,
      slot: 0,
      apaleoReservationId: r.apaleoReservationId,
      folioId: r.folioId,
      grossAmount: r.totalGrossAmount,
      currency: r.currency,
      paymentId: r.paymentId,
      paidAt: r.paidAt,
    },
  });
  reservationsCreated++;
}

console.log(
  `Backfilled ${lodgesCreated} SessionLodge rows (of ${sessions.length} sessions) and ${reservationsCreated} BookingReservation rows (of ${records.length} records).`,
);
await prisma.$disconnect();
