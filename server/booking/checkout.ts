import "server-only";
import { Prisma, type BookingRecord, type BookingReservation } from "@prisma/client";
import { prisma } from "../db";
import { createBooking, getFolioForReservation, type FolioSummary } from "../apaleo/bookings";
import { payFolio } from "../apaleo/payments";
import { ApaleoError } from "../apaleo/client";
import { PublicError } from "../api-helpers";
import { getSession, parseChildrenAges, parseExtras } from "./session";

type RecordWithReservations = BookingRecord & { reservations: BookingReservation[] };

/**
 * The "Buy now" moment, in three steps that mirror the real build:
 *   1. create the booking in Apaleo - one booking, one reservation per lodge
 *   2. read each reservation's folio - Apaleo's number for what is owed
 *   3. pay each folio (demo: manual "Other" payment)
 *
 * Ordering rules that keep money truthful:
 *   - The BookingRecord lookup comes BEFORE the session-expiry gate. Once a
 *     real reservation exists, a retry must resume it - telling the guest to
 *     "search again" would orphan the reservations and invite double booking.
 *   - The record is created carrying every folio's real total, so a crash
 *     between payment and the final update can never leave a paid booking
 *     recorded at 0.
 *   - Payment state lives per reservation (BookingReservation children):
 *     "crashed after paying folio 2 of 3" resumes by settling only what is
 *     still owed, never re-paying (per-slot idempotency keys) and never
 *     giving up.
 */
export async function completeCheckout(sessionId: string): Promise<BookingRecord> {
  const existing = await prisma.bookingRecord.findUnique({
    where: { sessionId },
    include: { reservations: { orderBy: { slot: "asc" } } },
  });
  if (existing?.status === "paid") return existing;

  // With a record in flight, shopping-session expiry no longer applies.
  const session = existing
    ? await prisma.bookingSession.findUnique({
        where: { id: sessionId },
        include: { lodges: { orderBy: { slot: "asc" } } },
      })
    : await getSession(sessionId);
  if (!session) {
    throw new PublicError(410, "Your booking session has expired. Please search again.");
  }
  if (
    session.lodges.length === 0 ||
    session.lodges.some((l) => !l.ratePlanId || !l.unitGroupCode)
  ) {
    throw new PublicError(400, "Choose a lodge for every part of your break.");
  }
  if (!session.guestFirstName || !session.guestLastName || !session.guestEmail) {
    throw new PublicError(400, "Guest details are missing.");
  }

  // 1. Booking in Apaleo (skipped if a previous attempt got this far).
  let record: RecordWithReservations | null = existing;
  if (!record) {
    const { bookingId, reservationIds } = await createBooking({
      arrival: session.arrival,
      departure: session.departure,
      reservations: session.lodges.map((lodge) => ({
        adults: lodge.adults,
        childrenAges: parseChildrenAges(lodge),
        ratePlanId: lodge.ratePlanId!,
        serviceIds: parseExtras(lodge).map((e) => e.serviceId),
      })),
      guest: {
        firstName: session.guestFirstName,
        lastName: session.guestLastName,
        email: session.guestEmail,
        phone: session.guestPhone ?? "",
      },
      vehiclePlate: session.vehiclePlate ?? undefined,
      idempotencyKey: `up-book-${session.id}`,
    });

    // One folio per reservation, read before the record exists so it is
    // born carrying the real total of every lodge.
    const folios: FolioSummary[] = [];
    for (const reservationId of reservationIds) {
      folios.push(await getFolioForReservation(reservationId));
    }
    const total = folios.reduce((sum, folio) => sum + Math.abs(folio.balance), 0);

    try {
      record = await prisma.bookingRecord.create({
        data: {
          sessionId: session.id,
          apaleoBookingId: bookingId,
          // Legacy mirror: slot 0's reservation and folio, for pages that
          // are not multi-lodge aware yet.
          apaleoReservationId: reservationIds[0],
          folioId: folios[0].folioId,
          totalGrossAmount: total,
          currency: folios[0].currency,
          // Ownership comes from the session row, never the cookie: a retry
          // can arrive logged-out and must still land under the account.
          userId: session.userId,
          reservations: {
            create: reservationIds.map((reservationId, slot) => ({
              slot,
              apaleoReservationId: reservationId,
              folioId: folios[slot].folioId,
              grossAmount: Math.abs(folios[slot].balance),
              currency: folios[slot].currency,
            })),
          },
        },
        include: { reservations: { orderBy: { slot: "asc" } } },
      });
    } catch (err) {
      // Two tabs racing Buy now: the loser resumes the winner's record and
      // proceeds to payment instead of erroring.
      const raced =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
          ? await prisma.bookingRecord.findUnique({
              where: { sessionId: session.id },
              include: { reservations: { orderBy: { slot: "asc" } } },
            })
          : null;
      if (!raced) throw err;
      record = raced;
    }

    // Stamp each lodge with its reservation, for manage and amend later.
    for (const [slot, reservationId] of reservationIds.entries()) {
      await prisma.sessionLodge.updateMany({
        where: { sessionId: session.id, slot },
        data: { apaleoReservationId: reservationId },
      });
    }
  }

  // 2 + 3. Settle every reservation still owing, one folio at a time.
  // Already-paid children are skipped, so a retry never double-pays.
  for (const child of record.reservations) {
    if (child.paidAt) continue;

    const folio = await getFolioForReservation(child.apaleoReservationId);
    const owed = Math.abs(folio.balance);

    // owed is 0 if a previous attempt paid this folio but crashed before
    // the child update - then we just record the paid state.
    let paymentId: string | null = child.paymentId;
    if (owed > 0) {
      try {
        const payment = await payFolio({
          folioId: folio.folioId,
          amount: owed,
          currency: folio.currency,
          receipt: `UP-${record.apaleoBookingId}-${child.slot + 1}`,
          idempotencyKey: `up-pay-${session.id}-${child.slot}`,
        });
        paymentId = payment.paymentId;
      } catch (err) {
        // A payment-stage Apaleo rejection is NOT a sold-out race - the
        // reservations are held. Tell the guest to simply retry; the loop
        // resumes from this child.
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
    await prisma.bookingReservation.update({
      where: { id: child.id },
      data: { paidAt: new Date(), paymentId, folioId: folio.folioId },
    });
  }

  // Legacy mirror for the record-level payment column: slot 0's payment.
  const slotZero = await prisma.bookingReservation.findUnique({
    where: { recordId_slot: { recordId: record.id, slot: 0 } },
  });

  const paid = await prisma.bookingRecord.update({
    where: { id: record.id },
    data: {
      status: "paid",
      paidAt: new Date(),
      paymentId: slotZero?.paymentId ?? record.paymentId,
      // A record created on an earlier attempt (before the guest signed in
      // mid-funnel) picks the stamp up here; a paid record never re-enters.
      // undefined (not null) when both are empty: never overwrite a claim
      // adoption that landed on the row while this checkout was running.
      userId: record.userId ?? session.userId ?? undefined,
    },
  });

  await prisma.bookingSession.update({
    where: { id: session.id },
    data: { state: "completed" },
  });

  return paid;
}
