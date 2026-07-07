import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getExtraOffers } from "@/server/apaleo/offers";
import { getSession, parseChildrenAges, setExtras } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

/** Live extras (Apaleo service offers) priced for this session's stay. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    if (!session.ratePlanId) return jsonError(400, "Choose a lodge first.");

    const extras = await getExtraOffers({
      ratePlanId: session.ratePlanId,
      arrival: session.arrival,
      departure: session.departure,
      adults: session.adults,
      childrenAges: parseChildrenAges(session),
    });
    return NextResponse.json({ extras });
  });
}

const ExtrasBody = z.object({
  extras: z.array(
    z.object({
      serviceId: z.string(),
      code: z.string(),
      name: z.string(),
      count: z.number().int().positive(),
      grossAmount: z.number().nonnegative(),
    }),
  ),
});

/** Save the chosen extras (snapshots of what Apaleo quoted). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    if (session.state === "completed") {
      return jsonError(409, "This booking is already confirmed. Start a new search to book another break.");
    }

    const parsed = ExtrasBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid extras.");

    await setExtras(id, parsed.data.extras);
    return NextResponse.json({ ok: true });
  });
}
