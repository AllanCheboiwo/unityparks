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
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    if (session.state === "completed") {
      return jsonError(409, "This booking is already confirmed — start a new search to book another break.");
    }

    const parsed = LodgeBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid lodge selection.");

    const updated = await chooseLodge(id, parsed.data);
    return NextResponse.json({ ok: true, sessionId: updated.id });
  });
}
