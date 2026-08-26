import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { resolveAlert } from "@/server/ops/alerts";

const ResolveBody = z.object({ alertId: z.string().min(1) });

/** Marks an alert looked-at. The row keeps its diagnostics forever; this
 * only stamps who decided it was handled. */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const admin = await requireAdmin();
    const parsed = ResolveBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid resolve request.");
    await resolveAlert(parsed.data.alertId, admin.email);
    return NextResponse.json({ ok: true });
  });
}
