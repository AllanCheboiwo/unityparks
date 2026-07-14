import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { confirmPesapalPayment } from "@/server/booking/checkout";

/**
 * Where Pesapal's hosted page sends the guest's browser after a payment
 * attempt. This is a navigation, not an API call, so every path out of here
 * is a redirect - never JSON. The redirect proves nothing about money: it
 * only tells us WHEN to ask Pesapal what happened. confirmPesapalPayment()
 * does the asking, and only its answer decides where the guest lands.
 */
export async function GET(req: NextRequest) {
  const trackingId = req.nextUrl.searchParams.get("OrderTrackingId");
  if (!trackingId) return NextResponse.redirect(new URL("/", req.url));

  try {
    const { outcome, record } = await confirmPesapalPayment(trackingId);
    if (outcome === "completed") {
      // Same handoff as the simulated flow: the session id is the
      // fresh-from-checkout proof of access for the confirmation page.
      return NextResponse.redirect(
        new URL(
          `/confirmation/${record.apaleoBookingId}?session=${record.sessionId}`,
          req.url,
        ),
      );
    }
    // pending or failed: back to the pay page, which explains and retries.
    return NextResponse.redirect(
      new URL(`/checkout/pay?session=${record.sessionId}&payment=${outcome}`, req.url),
    );
  } catch (err) {
    console.error("Pesapal callback failed", err);
    // Even on an error we try to land the guest back on their own pay page,
    // where Buy now resumes the attempt. Home is the last resort.
    const transaction = await prisma.pesapalTransaction
      .findUnique({ where: { orderTrackingId: trackingId }, include: { record: true } })
      .catch(() => null);
    const sessionId = transaction?.record.sessionId;
    return NextResponse.redirect(
      new URL(
        sessionId ? `/checkout/pay?session=${sessionId}&payment=error` : "/",
        req.url,
      ),
    );
  }
}
