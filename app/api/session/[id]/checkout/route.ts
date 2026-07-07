import { NextRequest, NextResponse } from "next/server";
import { completeCheckout } from "@/server/booking/checkout";
import { handleRoute } from "@/server/api-helpers";

/**
 * "Buy now": creates the booking in Apaleo, reads the folio, settles it with
 * the simulated payment, and records the paid state. Idempotent - a retry or
 * double-click returns the same paid booking.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const record = await completeCheckout(id);
    return NextResponse.json({
      bookingId: record.apaleoBookingId,
      reservationId: record.apaleoReservationId,
      status: record.status,
      totalGrossAmount: record.totalGrossAmount,
      currency: record.currency,
    });
  });
}
