import { NextRequest, NextResponse } from "next/server";
import { pendingRedemptionForSession } from "@/server/repeatOffer/derive";
import { z } from "zod";
import { getExtraOffers } from "@/server/apaleo/offers";
import { LOCATION_SERVICE_CODE, RETIRED_SERVICE_CODES } from "@/server/apaleo/units";
import { classifyCheckoutOffers, isTeaserSnapshot } from "@/lib/inventory";
import { governedServiceCodes } from "@/server/inventory/availability";
import { getSession, parseChildrenAges, setExtras } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { prisma } from "@/server/db";

/**
 * Live extras (Apaleo service offers) for one lodge of the break (?slot=,
 * default 0), priced against that lodge's rate plan and party - extras are
 * per lodge, the grocery pack goes to a specific kitchen. Resource-backed
 * services come back flagged as teasers (UNP-6, spec 5.10): the price is
 * Apaleo's, the card shows no quantity control, and the snapshot POST
 * refuses them.
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

    const offers = await getExtraOffers({
      ratePlanId: lodge.ratePlanId,
      arrival: session.arrival,
      departure: session.departure,
      adults: lodge.adults,
      childrenAges: parseChildrenAges(lodge),
    });
    // The location-choice fee is sold by the location step, never here.
    const extras = classifyCheckoutOffers(
      offers.filter((o) => o.code !== LOCATION_SERVICE_CODE),
      { resourceCodes: await governedServiceCodes(), retired: RETIRED_SERVICE_CODES },
    );
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
    // Once a real reservation exists its folio is a settled fact; a late
    // extras edit could never reach it and would only make summaries lie.
    if (await prisma.bookingRecord.findUnique({ where: { sessionId: id } })) {
      return jsonError(409, "Your booking is already being processed. Press Buy now to finish.");
    }
    // A PENDING redemption means a crashed checkout's offer allowances may
    // already sit on the folios, split over the current bases; changing
    // the basket now would make the replay's split diverge from what was
    // posted (UNP-7 review finding).
    if (session.userId != null && (await pendingRedemptionForSession(id))) {
      return jsonError(
        409,
        "Your booking is being confirmed with your repeat-guest offer applied. Press Buy now to finish.",
      );
    }

    const parsed = ExtrasBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid extras.");
    if (!session.lodges.some((l) => l.slot === parsed.data.slot)) {
      return jsonError(400, "That lodge slot is not part of this break.");
    }
    // Stock is never booked from checkout in v1 (UNP-25 is the entry point
    // with holds), and retired services are never booked at all; a snapshot
    // carrying either would make ensureRecord book what nobody held.
    if (isTeaserSnapshot(parsed.data.extras, await governedServiceCodes())) {
      return jsonError(400, "Activities are booked from your account after checkout.");
    }

    await setExtras(id, parsed.data.extras, parsed.data.slot);
    return NextResponse.json({ ok: true });
  });
}
