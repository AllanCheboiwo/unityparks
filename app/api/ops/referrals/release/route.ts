import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { releaseSpend } from "@/server/referral/ops";

const ReleaseBody = z.object({ entryId: z.string().min(1) });

/** Release credit locked in an abandoned checkout (plan 6.3): appends the
 * one-per-spend credit_release row. Human judgment only; nothing automatic
 * ever releases, because a "created" booking is resumable forever. */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    await requireAdmin();
    const parsed = ReleaseBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid release request.");
    await releaseSpend(parsed.data.entryId);
    return NextResponse.json({ ok: true });
  });
}
