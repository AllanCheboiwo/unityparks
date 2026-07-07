import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chooseLodge, getSession } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

const LodgeBody = z.object({
  unitGroupCode: z.string(),
  ratePlanId: z.string(),
  stayGrossAmount: z.number().positive(),
  currency: z.string(),
});

/** Put the chosen lodge (an Apaleo offer snapshot) in the basket. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    if (!(await getSession(id))) return jsonError(410, "Session expired.");

    const parsed = LodgeBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid lodge selection.");

    const session = await chooseLodge(id, parsed.data);
    return NextResponse.json({ ok: true, sessionId: session.id });
  });
}
