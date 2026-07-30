import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertBookingAccess } from "@/server/booking/access";
import { runPaymentAttempt } from "@/server/booking/checkout";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { isValidPartPayment, MIN_PART_PAYMENT } from "@/lib/paymentPlan";

/**
 * Balance payments from Manage my booking: the guest-initiated half of the
 * payment plan (there is no auto-charge, ever). One POST is one payment
 * attempt for one amount - the whole outstanding balance when the body
 * names no amount. The balance numbers themselves ride the booking GET;
 * this route only moves money, through the same attempt machinery as
 * checkout, so resume, serialization and settle behave identically.
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
    assertBookingAccess(record, {
      user: await getCurrentUser(),
      sessionId: req.nextUrl.searchParams.get("session"),
      email: req.nextUrl.searchParams.get("email"),
    });

    if (record.status === "paid") {
      return jsonError(400, "This booking has no outstanding balance.");
    }
    if (record.status !== "deposit_paid") {
      return jsonError(400, "This booking is not payable.");
    }

    // The exact remainder, unrounded: settlePayment validates the collected
    // amount against this same figure with the same epsilon. Rounding here
    // could overshoot the folio (wedging the payment in the 502 path) or
    // strand an unpayable fractional sliver forever.
    const outstanding = record.totalGrossAmount - record.paidAmount;
    if (outstanding <= 0.01) {
      return jsonError(400, "This booking has no outstanding balance.");
    }
    // `?? {}`: a literal `null` body parses successfully and must not crash.
    const body = ((await req.json().catch(() => ({}))) ?? {}) as { amount?: unknown };
    let amount: number;
    if (body.amount === undefined) {
      // "Pay the whole outstanding balance" collects the exact remainder,
      // fractional tails included - the whole-KES rule is for part payments.
      amount = outstanding;
    } else {
      if (
        typeof body.amount !== "number" ||
        !isValidPartPayment(body.amount, outstanding)
      ) {
        return jsonError(
          400,
          `A payment must be at least KES ${MIN_PART_PAYMENT} and either clear the balance exactly or leave at least KES ${MIN_PART_PAYMENT} to pay later.`,
        );
      }
      amount = body.amount;
    }

    const outcome = await runPaymentAttempt({
      record,
      session: record.session,
      kind: "balance",
      amount,
      ipnId: process.env.PESAPAL_IPN_ID ?? null,
    });
    if (outcome.kind === "redirect") {
      return NextResponse.json({ status: "redirect", redirectUrl: outcome.redirectUrl });
    }
    return NextResponse.json({
      status: outcome.record.status,
      paidAmount: outcome.record.paidAmount,
      totalGrossAmount: outcome.record.totalGrossAmount,
    });
  });
}
