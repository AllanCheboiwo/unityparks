import { NextRequest, NextResponse } from "next/server";
import { beginCheckout } from "@/server/booking/checkout";
import { handleRoute, jsonError } from "@/server/api-helpers";

/**
 * "Buy now": creates the booking in Apaleo, then either settles it on the
 * spot (simulated provider) or answers with Pesapal's payment page for the
 * client to redirect to. Idempotent - a retry or double-click resumes the
 * same booking wherever the last attempt stopped. The optional body picks
 * what to collect: the 30% deposit (when arrival is far enough out) or the
 * full amount; the server rechecks eligibility either way.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    // `?? {}`: a literal `null` body parses successfully and must not crash.
    const body = ((await req.json().catch(() => ({}))) ?? {}) as { payment?: unknown };
    const payment = body.payment ?? "full";
    if (payment !== "full" && payment !== "deposit") {
      return jsonError(400, "payment must be \"deposit\" or \"full\".");
    }
    const outcome = await beginCheckout(id, payment);
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
