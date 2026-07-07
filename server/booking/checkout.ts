import "server-only";
import type { BookingRecord } from "@prisma/client";
import { prisma } from "../db";
import { createBooking, getFolioForReservation } from "../apaleo/bookings";
import { payFolio } from "../apaleo/payments";
import { ApaleoError } from "../apaleo/client";
import { PublicError } from "../api-helpers";
import { getSession, parseChildrenAges, parseExtras } from "./session";

/**
 * The "Buy now" moment, in three steps that mirror the real build:
 *   1. create the booking in Apaleo (reservation + folio come into existence)
 *   2. read the folio - Apaleo's number for what is owed, not ours
 *   3. pay that amount onto the folio (demo: manual "Other" payment)
 *
 * Ordering rules that keep money truthful:
 *   - The BookingRecord lookup comes BEFORE the session-expiry gate. Once a
 *     real reservation exists, a retry must resume it - telling the guest to
 *     "search again" would orphan the reservation and invite a double booking.
 *   - The record is created carrying the folio's real total, so a crash
 *     between payment and the final update can never leave a paid booking
 *     recorded at 0.
 */
export async function completeCheckout(sessionId: string): Promise<BookingRecord> {
  const existing = await prisma.bookingRecord.findUnique({ where: { sessionId } });
  if (existing?.status === "paid") return existing;

  // With a record in flight, shopping-session expiry no longer applies.
  const session = existing
    ? await prisma.bookingSession.findUnique({ where: { id: sessionId } })
    : await getSession(sessionId);
  if (!session) {
    throw new PublicError(410, "Your booking session has expired. Please search again.");
  }
  if (!session.ratePlanId || !session.unitGroupCode) {
    throw new PublicError(400, "No lodge selected for this session.");
  }
  if (!session.guestFirstName || !session.guestLastName || !session.guestEmail) {
    throw new PublicError(400, "Guest details are missing.");
  }

  const extras = parseExtras(session);

  // 1. Booking in Apaleo (skipped if a previous attempt got this far).
  let record = existing;
  if (!record) {
    const { bookingId, reservationId } = await createBooking({
      arrival: session.arrival,
      departure: session.departure,
      adults: session.adults,
      childrenAges: parseChildrenAges(session),
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
    const folio = await getFolioForReservation(reservationId);
    record = await prisma.bookingRecord.create({
      data: {
        sessionId: session.id,
        apaleoBookingId: bookingId,
        apaleoReservationId: reservationId,
        folioId: folio.folioId,
        totalGrossAmount: Math.abs(folio.balance),
        currency: folio.currency,
      },
    });
  }

  // 2. What does Apaleo say is owed right now?
  const folio = await getFolioForReservation(record.apaleoReservationId);
  const owed = Math.abs(folio.balance);

  // 3. Settle it (owed is 0 if a previous attempt paid but crashed before
  // the record update - then we just record the paid state).
  let paymentId: string | null = record.paymentId;
  if (owed > 0) {
    try {
      const payment = await payFolio({
        folioId: folio.folioId,
        amount: owed,
        currency: folio.currency,
        receipt: `UP-${record.apaleoBookingId}`,
        idempotencyKey: `up-pay-${session.id}`,
      });
      paymentId = payment.paymentId;
    } catch (err) {
      // A payment-stage Apaleo rejection is NOT a sold-out race - the
      // reservation is held. Tell the guest to simply retry.
      if (err instanceof ApaleoError) {
        console.error("Folio payment failed", err.status, JSON.stringify(err.body)?.slice(0, 600));
        throw new PublicError(
          502,
          "Your lodge is reserved, but recording the payment failed. Press Buy now again to finish.",
        );
      }
      throw err;
    }
  }

  const paid = await prisma.bookingRecord.update({
    where: { id: record.id },
    data: {
      status: "paid",
      paidAt: new Date(),
      paymentId,
      folioId: folio.folioId,
    },
  });

  await prisma.bookingSession.update({
    where: { id: session.id },
    data: { state: "completed" },
  });

  return paid;
}
