import { NextRequest, NextResponse } from "next/server";
import { handleRoute } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { runRepeatOffers } from "@/server/repeatOffer/ops";

/**
 * The repeat-offer trigger: sweep stale PENDING redemptions, then send the
 * post-stay reminder emails. Two ways in, same as the reminders run: a
 * signed-in admin (the button on /ops/repeat-offers), or an external
 * scheduler presenting the REPEAT_OFFERS_RUN_SECRET bearer. Idempotent by
 * construction: every send claims the offerEmailSentAt stamp, and the
 * sweep is conditional on PENDING.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const secret = process.env.REPEAT_OFFERS_RUN_SECRET;
    const bearerOk =
      Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
    if (!bearerOk) await requireAdmin();

    const summary = await runRepeatOffers();
    console.log(
      `[repeat-offers] run: ${summary.sent} sent of ${summary.considered} candidates, ${summary.swept} stale claims swept`,
    );
    return NextResponse.json(summary);
  });
}
