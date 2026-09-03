import { NextRequest, NextResponse } from "next/server";
import { pendingRedemptionForSession } from "@/server/repeatOffer/derive";
import { z } from "zod";
import { getExtraOffers } from "@/server/apaleo/offers";
import { getAvailableUnits, LOCATION_SERVICE_CODE } from "@/server/apaleo/units";
import { getSession, parseChildrenAges, setLocation } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { prisma } from "@/server/db";
import type { SessionWithLodges } from "@/server/booking/session";
import type { SessionLodge } from "@prisma/client";

/**
 * The location step's data for one lodge of the break (?slot=, default 0):
 * which physical lodges are free for the stay by Apaleo's availability math,
 * minus any unit another slot of this break already picked, plus the choice
 * fee exactly as Apaleo's service offer prices it.
 */

async function loadOffers(session: SessionWithLodges, lodge: SessionLodge) {
  const [available, offers] = await Promise.all([
    getAvailableUnits({
      arrival: session.arrival,
      departure: session.departure,
      unitGroupCode: lodge.unitGroupCode!,
    }),
    getExtraOffers({
      ratePlanId: lodge.ratePlanId!,
      arrival: session.arrival,
      departure: session.departure,
      adults: lodge.adults,
      childrenAges: parseChildrenAges(lodge),
    }),
  ]);

  // A unit picked by one lodge of this break is spoken for even though
  // Apaleo still counts it available (nothing is booked yet).
  const takenBySiblings = new Set(
    session.lodges
      .filter((l) => l.slot !== lodge.slot && l.locationUnitId)
      .map((l) => l.locationUnitId!),
  );
  const units = available.filter((u) => !takenBySiblings.has(u.id));
  const feeOffer = offers.find((o) => o.code === LOCATION_SERVICE_CODE) ?? null;
  return { units, feeOffer };
}

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
    if (!lodge.unitGroupCode || !lodge.ratePlanId) {
      return jsonError(400, "Choose a lodge first.");
    }

    const { units, feeOffer } = await loadOffers(session, lodge);
    return NextResponse.json({
      slot,
      units,
      fee: feeOffer
        ? {
            serviceId: feeOffer.serviceId,
            amount: feeOffer.totalGrossAmount,
            currency: feeOffer.currency,
          }
        : null,
    });
  });
}

// The client only says WHICH unit, or that the break's lodges go together;
// the name, the fee service and the fee amount are all derived server-side
// from Apaleo, so a doctored request can never smuggle in a unit from
// another tier, a foreign service id, or a made-up price.
const LocationBody = z.discriminatedUnion("choice", [
  z.object({
    choice: z.literal("none"),
    slot: z.number().int().min(0).max(2).default(0),
  }),
  z.object({
    choice: z.literal("unit"),
    unitId: z.string().min(1),
    slot: z.number().int().min(0).max(2).default(0),
  }),
  z.object({
    choice: z.literal("together"),
    slot: z.number().int().min(0).max(2).default(0),
  }),
]);

/** Save one lodge's location choice. */
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
    // Same freeze as guest details: once a real reservation exists, its
    // folio and assignment are settled facts - a late edit here could never
    // reach them and would only make the summaries lie.
    if (await prisma.bookingRecord.findUnique({ where: { sessionId: id } })) {
      return jsonError(409, "Your booking is already being processed. Press Buy now to finish.");
    }
    // A PENDING redemption freezes the bases its crashed allowances were
    // split over (UNP-7 review finding).
    if (session.userId != null && (await pendingRedemptionForSession(id))) {
      return jsonError(
        409,
        "Your booking is being confirmed with your repeat-guest offer applied. Press Buy now to finish.",
      );
    }

    const parsed = LocationBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid location choice.");
    const body = parsed.data;
    const lodge = session.lodges.find((l) => l.slot === body.slot);
    if (!lodge) return jsonError(400, "That lodge slot is not part of this break.");

    if (body.choice === "none") {
      await setLocation(id, { choice: "none" }, body.slot);
      return NextResponse.json({ ok: true });
    }

    if (!lodge.unitGroupCode || !lodge.ratePlanId) {
      return jsonError(400, "Choose a lodge first.");
    }

    if (body.choice === "together") {
      if (session.lodges.length < 2) {
        return jsonError(400, "Placing lodges together needs more than one lodge in your break.");
      }
      const { feeOffer } = await loadOffers(session, lodge);
      if (!feeOffer) {
        return jsonError(502, "Lodge selection isn't available right now. Choose no preference to continue.");
      }
      await setLocation(
        id,
        { choice: "together", serviceId: feeOffer.serviceId, fee: feeOffer.totalGrossAmount },
        body.slot,
      );
      return NextResponse.json({ ok: true });
    }

    if (
      session.lodges.some((l) => l.slot !== body.slot && l.locationUnitId === body.unitId)
    ) {
      return jsonError(400, "Another lodge in your break already has that lodge number. Pick a different one.");
    }

    const { units, feeOffer } = await loadOffers(session, lodge);
    const unit = units.find((u) => u.id === body.unitId);
    if (!unit) {
      return jsonError(409, "That lodge is no longer available for your dates. Pick another from the list.");
    }
    if (!feeOffer) {
      return jsonError(502, "Lodge selection isn't available right now. Choose no preference to continue.");
    }

    await setLocation(
      id,
      {
        choice: "unit",
        unitId: unit.id,
        unitName: unit.name,
        serviceId: feeOffer.serviceId,
        fee: feeOffer.totalGrossAmount,
      },
      body.slot,
    );
    return NextResponse.json({ ok: true });
  });
}
