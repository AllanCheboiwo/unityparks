import { NextRequest, NextResponse } from "next/server";
import { handleRoute } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { runReconcile } from "@/server/inventory/ops";

/**
 * Reconciliation (UNP-6, spec 5.12): check the three invariants and file
 * each violation as an inventory_drift OpsAlert. Reports, never fixes.
 * Admin button, or an external scheduler with INVENTORY_RUN_SECRET.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const secret = process.env.INVENTORY_RUN_SECRET;
    const bearerOk =
      Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
    if (!bearerOk) await requireAdmin();
    const summary = await runReconcile();
    console.log(
      `[inventory] reconcile: ${summary.violations.length} violations, ${summary.filed} newly filed`,
    );
    return NextResponse.json(summary);
  });
}
