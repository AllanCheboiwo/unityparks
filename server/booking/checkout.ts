import "server-only";
import type { BookingRecord } from "@prisma/client";
import { prisma } from "../db";
import { createBooking, getFolioForReservation } from "../apaleo/bookings";
import { payFolio } from "../apaleo/payments";
import { getSession, parseExtras } from "./session";

/**
 * The "Buy now" moment, in three steps that mirror the real build:
 *   1. create the booking in Apaleo (reservation + folio come into existence)
 *   2. read the folio — Apaleo's number for what is owed, not ours
 *   3. pay that amount onto the folio (demo: manual "Other" payment)
 *
 * The BookingRecord is written after step 1 and marked paid after step 3,
 * so the database always tells the truth about how far checkout got.
 */
export async function completeCheckout(sessionId: string): Promise<BookingRecord> {
  const session = await getSession(sessionId);
  if (!session) throw new Error("Your booking session has expired. Please search again.");

  // Double-click / retry protection at our level; Apaleo's Idempotency-Key
  // protects the network level.
  const existing = await prisma.bookingRecord.findUnique({ where: { sessionId } });
  if (existing?.status === "paid") return existing;

  if (!session.ratePlanId || !session.unitGroupCode) {
    throw new Error("No lodge selected for this session.");
  }
  if (!session.guestFirstName || !session.guestLastName || !session.guestEmail) {
    throw new Error("Guest details are missing.");
  }

  const extras = parseExtras(session);

  // 1. Booking in Apaleo (skipped if a previous attempt got this far).
  let record = existing;
  if (!record) {
    const { bookingId, reservationId } = await createBooking({
      arrival: session.arrival,
      departure: session.departure,
      adults: session.adults,
      ratePlanId: session.ratePlanId,
      serviceIds: extras.map((e) => e.serviceId),
      guest: {
        firstName: session.guestFirstName,
        lastName: session.guestLastName,
        email: session.guestEmail,
        phone: session.guestPhone ?? "",
      },
      vehiclePlate: session.vehiclePlate ?? undefined,
      idempotencyKey: `up-book-${session.id}`,
    });
    record = await prisma.bookingRecord.create({
      data: {
        sessionId: session.id,
        apaleoBookingId: bookingId,
        apaleoReservationId: reservationId,
        totalGrossAmount: 0, // set from the folio below
        currency: session.currency,
      },
    });
  }

  // 2. What does Apaleo say is owed?
  const folio = await getFolioForReservation(record.apaleoReservationId);
  const owed = Math.abs(folio.balance);

  // 3. Settle it (owed can be 0 if a previous attempt paid but crashed before
  // the record update — then we just record the paid state).
  let paymentId: string | null = record.paymentId;
  if (owed > 0) {
    const payment = await payFolio({
      folioId: folio.folioId,
      amount: owed,
      currency: folio.currency,
      receipt: `UP-${record.apaleoBookingId}`,
      idempotencyKey: `up-pay-${session.id}`,
    });
    paymentId = payment.paymentId;
  }

  const paid = await prisma.bookingRecord.update({
    where: { id: record.id },
    data: {
      status: "paid",
      paidAt: new Date(),
      paymentId,
      totalGrossAmount: owed > 0 ? owed : record.totalGrossAmount,
      folioId: folio.folioId,
    },
  });

  await prisma.bookingSession.update({
    where: { id: session.id },
    data: { state: "completed" },
  });

  return paid;
}
