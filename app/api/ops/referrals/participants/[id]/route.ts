import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { setRevoked } from "@/server/referral/ops";

const RevokeBody = z.object({ revoked: z.boolean() });

/** Revoke (or reinstate) a participant. Rows are never deleted; a revoked
 * code refuses at validation with a friendly message. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    await requireAdmin();
    const { id } = await params;
    const parsed = RevokeBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid revoke request.");
    await setRevoked(id, parsed.data.revoked);
    return NextResponse.json({ ok: true });
  });
}
