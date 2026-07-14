import { NextRequest, NextResponse } from "next/server";
import { beginCheckout } from "@/server/booking/checkout";
import { handleRoute } from "@/server/api-helpers";

/**
 * "Buy now": creates the booking in Apaleo, then either settles it on the
 * spot (simulated provider) or answers with Pesapal's payment page for the
 * client to redirect to. Idempotent - a retry or double-click resumes the
 * same booking wherever the last attempt stopped.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const outcome = await beginCheckout(id);
    if (outcome.kind === "redirect") {
      return NextResponse.json({
        status: "redirect",
        redirectUrl: outcome.redirectUrl,
      });
    }
    const record = outcome.record;
    return NextResponse.json({
      bookingId: record.apaleoBookingId,
      reservationId: record.apaleoReservationId,
      status: record.status,
      totalGrossAmount: record.totalGrossAmount,
      currency: record.currency,
    });
  });
}
