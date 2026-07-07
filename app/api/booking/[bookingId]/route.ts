import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getFolioForReservation } from "@/server/apaleo/bookings";
import { parseExtras } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

/**
 * Confirmation data, driven by our recorded state (never a redirect) plus a
 * live folio read so "settled" is Apaleo's word, not ours.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await prisma.bookingRecord.findFirst({
      where: { apaleoBookingId: bookingId },
      include: { session: true },
    });
    if (!record) return jsonError(404, "Booking not found.");

    const folio = await getFolioForReservation(record.apaleoReservationId);

    return NextResponse.json({
      bookingId: record.apaleoBookingId,
      reservationId: record.apaleoReservationId,
      status: record.status,
      paidAt: record.paidAt,
      totalGrossAmount: record.totalGrossAmount,
      currency: record.currency,
      folioBalance: folio.balance,
      stay: {
        arrival: record.session.arrival,
        departure: record.session.departure,
        adults: record.session.adults,
        unitGroupCode: record.session.unitGroupCode,
        stayGrossAmount: record.session.stayGrossAmount,
      },
      extras: parseExtras(record.session),
      guest: {
        firstName: record.session.guestFirstName,
        lastName: record.session.guestLastName,
        email: record.session.guestEmail,
        vehiclePlate: record.session.vehiclePlate,
      },
    });
  });
}
