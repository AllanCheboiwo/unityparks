import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { addAdjustment } from "@/server/inventory/ops";

/** Reality as a hold with a reason (UNP-6, spec 5.9). Admin only. */
const Body = z.object({
  resourceCode: z.string().min(1).max(32),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  qty: z.number().int().min(1).max(100_000),
  reason: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const admin = await requireAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Check the adjustment fields.");
    const result = await addAdjustment({ ...parsed.data, createdBy: admin.email });
    return NextResponse.json({ ok: true, ...result });
  });
}
