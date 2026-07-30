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
  // Behind Railway's proxy req.url carries the container-local host
  // (localhost:8080), so guest-facing redirects are built from APP_BASE_URL.
  const base = process.env.APP_BASE_URL ?? req.url;
  const trackingId = req.nextUrl.searchParams.get("OrderTrackingId");
  if (!trackingId) return NextResponse.redirect(new URL("/", base));

  try {
    const { outcome, record, kind } = await confirmPesapalPayment(trackingId);
    // Balance payments belong to Manage my booking: that page explains
    // every outcome, and the session id doubles as its proof of access.
    if (kind === "balance") {
      return NextResponse.redirect(
        new URL(
          `/manage/${record.apaleoBookingId}?session=${record.sessionId}&payment=${outcome === "completed" ? "success" : outcome}`,
          base,
        ),
      );
    }
    if (outcome === "completed") {
      // Same handoff as the simulated flow: the session id is the
      // fresh-from-checkout proof of access for the confirmation page.
      return NextResponse.redirect(
        new URL(
          `/confirmation/${record.apaleoBookingId}?session=${record.sessionId}`,
          base,
        ),
      );
    }
    // pending or failed: back to the pay page, which explains and retries.
    return NextResponse.redirect(
      new URL(`/checkout/pay?session=${record.sessionId}&payment=${outcome}`, base),
    );
  } catch (err) {
    console.error("Pesapal callback failed", err);
    // Even on an error we try to land the guest back on their own page
    // (Manage for balance payments, the pay page for checkout), where a
    // retry resumes the attempt. Home is the last resort.
    const transaction = await prisma.pesapalTransaction
      .findUnique({ where: { orderTrackingId: trackingId }, include: { record: true } })
      .catch(() => null);
    const sessionId = transaction?.record.sessionId;
    if (!sessionId) return NextResponse.redirect(new URL("/", base));
    return NextResponse.redirect(
      new URL(
        transaction!.kind === "balance"
          ? `/manage/${transaction!.record.apaleoBookingId}?session=${sessionId}&payment=error`
          : `/checkout/pay?session=${sessionId}&payment=error`,
        base,
      ),
    );
  }
}
