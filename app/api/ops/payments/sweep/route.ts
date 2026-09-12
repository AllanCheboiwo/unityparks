import { NextRequest, NextResponse } from "next/server";
import { handleRoute } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { runPaymentSweep } from "@/server/booking/sweepWire";

/**
 * The payment sweep (UNP-40, UNP-46): confirm live Pesapal attempts nobody
 * told us about, retire and report attempts that lost their reference, and
 * run recovery on stale extras orders. Admin session, or the scheduler
 * presenting PAYMENTS_RUN_SECRET. Idempotent by construction: every state
 * change goes through the same confirm and recovery code the guest paths
 * run, so running it twice is free.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const secret = process.env.PAYMENTS_RUN_SECRET;
    const bearerOk =
      Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
    if (!bearerOk) await requireAdmin();

    const summary = await runPaymentSweep();
    console.log(
      `[payments] sweep: ${summary.checked} checked, ${summary.settled} settled, ${summary.retired} retired, ${summary.unlinked} unlinked, ${summary.extrasRecovered} extras recovered, ${summary.errored} errored`,
    );
    return NextResponse.json(summary);
  });
}
