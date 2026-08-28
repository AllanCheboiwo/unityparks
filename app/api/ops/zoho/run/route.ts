import { NextResponse } from "next/server";
import { handleRoute } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { runZohoExports } from "@/server/zoho/wire";

/**
 * The manual Zoho drain (UNP-5): retries pending AND failed rows, oldest
 * first. Admin-only; automatic retries already ride along on every inline
 * push, so this button exists for rows that escalated past MAX_ATTEMPTS
 * and for watching a stuck queue drain by hand. Running it twice is free.
 */
export async function POST() {
  return handleRoute(async () => {
    await requireAdmin();
    const summary = await runZohoExports();
    console.log(`[zoho] ops run: ${summary.done} done, ${summary.errored} errored`);
    return NextResponse.json(summary);
  });
}
