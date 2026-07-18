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
import { ApaleoError } from "@/server/apaleo/client";
import { nightsBetween, validateStay } from "@/server/booking/rules";
import { assertBookingAccess } from "@/server/booking/access";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError, PublicError } from "@/server/api-helpers";

const AmendBody = z.object({
  arrival: z.string(),
  departure: z.string(),
});

/**
 * Move a booked break to new dates - the whole break, every lodge together.
 * Apaleo only checks availability here; the Friday/Monday turnover rule is
 * OURS to re-apply. The break keeps its length; resizing a stay, dropping a
 * lodge or splitting dates is call-our-team territory.
 *
 * The loop is shaped so the break can never be left half-moved:
 *   1. quote EVERY lodge for the new dates before touching any (a single
 *      unavailable lodge refuses the whole move),
 *   2. amend one reservation at a time; if one fails, roll the already-moved
 *      ones back to the original dates,
 *   3. settle each folio that a price difference left owing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await prisma.bookingRecord.findFirst({
      where: { apaleoBookingId: bookingId },
      include: {
        session: true,
        reservations: { orderBy: { slot: "asc" } },
      },
    });
    if (!record) return jsonError(404, "Booking not found.");

    // Before anything Apaleo: this route moves sandbox money, and failed
    // probes must not burn the tight write budget.
    assertBookingAccess(record, {
      user: await getCurrentUser(),
      sessionId: req.nextUrl.searchParams.get("session"),
      email: req.nextUrl.searchParams.get("email"),
    });

    // A booking awaiting payment must not change shape: a Pesapal order for
    // the old total may be minutes from settling, and the amount collected
    // has to match what the folios ask for at settle time.
    if (record.status !== "paid") {
      return jsonError(409, "Finish paying for your break before changing it.");
    }

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

    const slots =
      record.reservations.length > 0
        ? record.reservations.map((r) => ({ slot: r.slot, reservationId: r.apaleoReservationId }))
        : [{ slot: 0, reservationId: record.apaleoReservationId }];
    const multi = slots.length > 1;

    // 1. Quote every lodge before moving any: a single sold-out lodge means
    // nothing moves, so the break can never be split by a known refusal.
    const lodges: Array<{
      slot: number;
      reservationId: string;
      adults: number;
      childrenAges?: number[];
      ratePlanId: string;
    }> = [];
    for (const { slot, reservationId } of slots) {
      const reservation = await getReservation(reservationId);
      const quote = await getAmendmentQuote({
        reservationId,
        unitGroupCode: reservation.unitGroup.code,
        arrival,
        departure,
      });
      if (!quote) {
        return NextResponse.json(
          {
            error: multi
              ? `Lodge ${slot + 1} isn't available for those dates, so nothing was moved. Try different dates.`
              : "Your lodge isn't available for those dates.",
            soldOut: true,
          },
          { status: 409 },
        );
      }
      lodges.push({
        slot,
        reservationId,
        adults: reservation.adults,
        childrenAges: reservation.childrenAges,
        ratePlanId: reservation.ratePlan.id,
      });
    }

    // 2. Move each reservation. On failure, put the already-moved ones back:
    // a half-moved break is the one state this route must never leave behind.
    const originalArrival = record.session.arrival;
    const originalDeparture = record.session.departure;
    const moved: typeof lodges = [];
    try {
      for (const lodge of lodges) {
        await amendReservationDates({
          reservationId: lodge.reservationId,
          arrival,
          departure,
          adults: lodge.adults,
          childrenAges: lodge.childrenAges,
          ratePlanId: lodge.ratePlanId,
        });
        moved.push(lodge);
      }
    } catch (err) {
      let rollbackFailed = false;
      for (const lodge of moved) {
        try {
          await amendReservationDates({
            reservationId: lodge.reservationId,
            arrival: originalArrival,
            departure: originalDeparture,
            adults: lodge.adults,
            childrenAges: lodge.childrenAges,
            ratePlanId: lodge.ratePlanId,
          });
        } catch (rollbackErr) {
          rollbackFailed = true;
          console.error("Amend rollback failed", lodge.reservationId, rollbackErr);
        }
      }
      if (rollbackFailed) {
        console.error("Amend left a break part-moved", record.apaleoBookingId, err);
        throw new PublicError(
          502,
          "We couldn't move every lodge and couldn't fully undo the change. Call our team on +254 700 000 000 and we'll put it right.",
        );
      }
      if (err instanceof ApaleoError && err.status === 422) {
        return NextResponse.json(
          {
            error: "One of your lodges was taken while we were moving your break, so it stays on its original dates. Try different dates.",
            soldOut: true,
          },
          { status: 409 },
        );
      }
      console.error("Amend failed, rolled back", record.apaleoBookingId, err);
      throw new PublicError(
        502,
        "Moving your break failed, so it stays on its original dates. Please try again.",
      );
    }

    // 3. Same length + flat pricing usually means folios stay settled, but a
    // seasonal price difference would leave a balance - settle it per lodge.
    let folioBalance = 0;
    for (const lodge of lodges) {
      const folio = await getFolioForReservation(lodge.reservationId);
      if (folio.balance < 0) {
        await payFolio({
          folioId: folio.folioId,
          amount: Math.abs(folio.balance),
          currency: folio.currency,
          receipt: `UP-${record.apaleoBookingId}-AMEND-${lodge.slot + 1}`,
          idempotencyKey: `up-amend-${record.id}-${lodge.slot}-${arrival}`,
        });
        const settled = await getFolioForReservation(lodge.reservationId);
        folioBalance += settled.balance;
      } else {
        folioBalance += folio.balance;
      }
    }

    await prisma.bookingSession.update({
      where: { id: record.sessionId },
      data: { arrival, departure },
    });

    // A moved break no longer holds its old physical lodge: Apaleo re-books
    // the unit group at the new dates, so any assigned unit is stale. Clear
    // the stored names rather than show a lodge number nobody is promised.
    await prisma.bookingReservation.updateMany({
      where: { recordId: record.id },
      data: { assignedUnitId: null, assignedUnitName: null },
    });

    return NextResponse.json({
      ok: true,
      arrival,
      departure,
      folioBalance,
    });
  });
}
