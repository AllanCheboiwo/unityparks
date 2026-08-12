import { NextRequest, NextResponse } from "next/server";
import { handleRoute } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { runBalanceReminders } from "@/server/booking/reminders";

/**
 * The reminder trigger, the system's only "scheduled" surface. Two ways in:
 * a signed-in admin (the button on /ops/reminders), or an external
 * scheduler (Railway cron, curl in a crontab) presenting the bearer secret
 * REMINDERS_RUN_SECRET. Idempotent by construction - every send claims a
 * once-only stamp - so overlapping or repeated runs cost nothing.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const secret = process.env.REMINDERS_RUN_SECRET;
    const bearerOk =
      Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
    if (!bearerOk) await requireAdmin();

    const summary = await runBalanceReminders();
    console.log(
      `[reminders] run: ${summary.sent.length} sent of ${summary.considered} open balances`,
    );
    return NextResponse.json(summary);
  });
}
