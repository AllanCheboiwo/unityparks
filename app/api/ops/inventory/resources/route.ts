import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { saveResource } from "@/server/inventory/ops";

/** Create or edit a resource by code (UNP-6, spec 5.11). Admin only. */
const Body = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,32}$/),
  name: z.string().min(1).max(80),
  kind: z.enum(["STOCK", "SESSION"]),
  capacity: z.number().int().min(0).max(100_000),
  sessionStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  sessionMinutes: z.number().int().min(1).max(24 * 60).nullable(),
  apaleoServiceCode: z.string().regex(/^[A-Z0-9-]{2,32}$/),
  openDaysBefore: z.number().int().min(0).max(730).nullable(),
  capRule: z.enum(["adults", "children"]),
  sellAtCheckout: z.boolean(),
  active: z.boolean(),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    await requireAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Check the resource fields.");
    return NextResponse.json(await saveResource(parsed.data));
  });
}
