import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import {
  amendReservationDates,
  getAmendmentQuote,
  getReservation,
} from "@/server/apaleo/amend";
import { getFolioForReservation } from "@/server/apaleo/bookings";
import { payFolio } from "@/server/apaleo/payments";
import { nightsBetween, validateStay } from "@/server/booking/rules";
import { handleRoute, jsonError } from "@/server/api-helpers";

const AmendBody = z.object({
  arrival: z.string(),
  departure: z.string(),
});

/**
 * Move a booked break to new dates. Apaleo only checks availability here -
 * the Friday/Monday turnover rule is OURS to re-apply, which is exactly what
 * this route demonstrates. The break keeps its length; resizing a stay (with
 * refunds) is real-build territory.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await prisma.bookingRecord.findFirst({
      where: { apaleoBookingId: bookingId },
      include: { session: true },
    });
    if (!record) return jsonError(404, "Booking not found.");

    const parsed = AmendBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please choose new dates.");
    const { arrival, departure } = parsed.data;

    // Our rules first - Apaleo would allow a Wednesday.
    const today = new Date().toISOString().slice(0, 10);
    if (arrival < today) {
      return NextResponse.json(
        { refused: true, reason: "That arrival date has already passed. Pick an upcoming Friday or Monday." },
        { status: 422 },
      );
    }
    const stay = validateStay(arrival, departure);
    if (!stay.ok) {
      return NextResponse.json({ refused: true, reason: stay.reason }, { status: 422 });
    }
    const currentNights = nightsBetween(record.session.arrival, record.session.departure);
    if (stay.nights !== currentNights) {
      return NextResponse.json(
        {
          refused: true,
          reason: `Your break is ${currentNights} nights. Pick a new start date and it moves as a whole. To change its length, call our team.`,
        },
        { status: 422 },
      );
    }

    const reservation = await getReservation(record.apaleoReservationId);
    const quote = await getAmendmentQuote({
      reservationId: record.apaleoReservationId,
      unitGroupCode: reservation.unitGroup.code,
      arrival,
      departure,
    });
    if (!quote) {
      return NextResponse.json(
        { error: "Your lodge isn't available for those dates.", soldOut: true },
        { status: 409 },
      );
    }

    await amendReservationDates({
      reservationId: record.apaleoReservationId,
      arrival,
      departure,
      adults: reservation.adults,
      childrenAges: reservation.childrenAges,
      ratePlanId: reservation.ratePlan.id,
    });

    // Same length + flat pricing usually means the folio stays settled, but a
    // seasonal price difference would leave a balance - settle it the demo way.
    const folio = await getFolioForReservation(record.apaleoReservationId);
    if (folio.balance < 0) {
      await payFolio({
        folioId: folio.folioId,
        amount: Math.abs(folio.balance),
        currency: folio.currency,
        receipt: `UP-${record.apaleoBookingId}-AMEND`,
        idempotencyKey: `up-amend-${record.id}-${arrival}`,
      });
    }
    const settledFolio = await getFolioForReservation(record.apaleoReservationId);

    await prisma.bookingSession.update({
      where: { id: record.sessionId },
      data: { arrival, departure },
    });

    return NextResponse.json({
      ok: true,
      arrival,
      departure,
      folioBalance: settledFolio.balance,
    });
  });
}
