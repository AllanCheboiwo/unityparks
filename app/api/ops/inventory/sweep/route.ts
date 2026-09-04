import { NextRequest, NextResponse } from "next/server";
import { handleRoute } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { runSweep } from "@/server/inventory/ops";

/**
 * The inventory sweep (UNP-6, spec 5.7): release every expired HELD hold.
 * Correctness never depends on it (placement sweeps lazily); it keeps the
 * ledger tidy. Admin button, or an external scheduler presenting
 * INVENTORY_RUN_SECRET. Running it twice is free.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const secret = process.env.INVENTORY_RUN_SECRET;
    const bearerOk =
      Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
    if (!bearerOk) await requireAdmin();
    const summary = await runSweep();
    console.log(`[inventory] sweep: ${summary.released} expired holds released`);
    return NextResponse.json(summary);
  });
}
