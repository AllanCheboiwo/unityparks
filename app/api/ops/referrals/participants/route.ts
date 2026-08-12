import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { createInfluencer } from "@/server/referral/ops";

const CreateBody = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  code: z.string().trim().min(3).max(12),
  // A fraction, e.g. 0.04. Blank means the config default in force at each
  // booking applies.
  commissionRate: z.number().optional(),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    await requireAdmin();
    const parsed = CreateBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Check the influencer form.");
    const participant = await createInfluencer({
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      code: parsed.data.code,
      commissionRate: parsed.data.commissionRate ?? null,
    });
    return NextResponse.json({ id: participant.id, code: participant.code });
  });
}
