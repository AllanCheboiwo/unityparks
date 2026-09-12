import { NextRequest, NextResponse } from "next/server";
import { handleRoute } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { runZohoExports } from "@/server/zoho/wire";

/**
 * The Zoho drain (UNP-5): retries pending AND failed rows, oldest first.
 * Two ways in, same as the other run routes: a signed-in admin (the button
 * on /ops/zoho), or the scheduler presenting ZOHO_RUN_SECRET (UNP-41,
 * UNP-46). Automatic retries already ride along on every inline push;
 * the scheduled run exists for rows that escalated past MAX_ATTEMPTS.
 * Running it twice is free.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const secret = process.env.ZOHO_RUN_SECRET;
    const bearerOk =
      Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
    if (!bearerOk) await requireAdmin();

    const summary = await runZohoExports();
    console.log(`[zoho] ops run: ${summary.done} done, ${summary.errored} errored`);
    return NextResponse.json(summary);
  });
}
