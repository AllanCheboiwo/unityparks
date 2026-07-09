import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getExtraOffers } from "@/server/apaleo/offers";
import { getSession, parseChildrenAges, setExtras } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

/**
 * Live extras (Apaleo service offers) for one lodge of the break (?slot=,
 * default 0), priced against that lodge's rate plan and party - extras are
 * per lodge, the grocery pack goes to a specific kitchen.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");

    const slot = Number(req.nextUrl.searchParams.get("slot") ?? 0);
    const lodge = session.lodges.find((l) => l.slot === slot);
    if (!lodge) return jsonError(400, "That lodge slot is not part of this break.");
    if (!lodge.ratePlanId) return jsonError(400, "Choose a lodge first.");

    const extras = await getExtraOffers({
      ratePlanId: lodge.ratePlanId,
      arrival: session.arrival,
      departure: session.departure,
      adults: lodge.adults,
      childrenAges: parseChildrenAges(lodge),
    });
    return NextResponse.json({ extras, slot });
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
  // Which lodge these extras belong to.
  slot: z.number().int().min(0).max(2).default(0),
});

/** Save one lodge's chosen extras (snapshots of what Apaleo quoted). */
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
    if (!session.lodges.some((l) => l.slot === parsed.data.slot)) {
      return jsonError(400, "That lodge slot is not part of this break.");
    }

    await setExtras(id, parsed.data.extras, parsed.data.slot);
    return NextResponse.json({ ok: true });
  });
}
