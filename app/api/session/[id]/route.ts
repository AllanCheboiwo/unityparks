import { NextRequest, NextResponse } from "next/server";
import { getSession, parseChildrenAges, parseExtras } from "@/server/booking/session";
import { computeTotal, nightsBetween } from "@/server/booking/rules";
import { partyLabel } from "@/server/booking/party";
import { handleRoute, jsonError } from "@/server/api-helpers";

/** Everything a funnel page needs to render this session's basket. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");

    const extras = parseExtras(session);
    const total =
      session.stayGrossAmount != null
        ? computeTotal(session.stayGrossAmount, extras)
        : null;

    // One entry per lodge in the break. The flat lodge/extras fields below
    // remain the slot-0 mirror while single-lodge clients migrate.
    const lodges = session.lodges.map((l) => {
      const ages = JSON.parse(l.childrenAges) as number[];
      return {
        slot: l.slot,
        adults: l.adults,
        childrenAges: ages,
        partyLabel: partyLabel(l.adults, ages),
        lodge: l.unitGroupCode
          ? {
              unitGroupCode: l.unitGroupCode,
              ratePlanId: l.ratePlanId,
              stayGrossAmount: l.stayGrossAmount,
              currency: session.currency,
            }
          : null,
        extras: JSON.parse(l.extras),
      };
    });

    return NextResponse.json({
      lodges,
      sessionId: session.id,
      state: session.state,
      arrival: session.arrival,
      departure: session.departure,
      nights: nightsBetween(session.arrival, session.departure),
      adults: session.adults,
      partyLabel: partyLabel(session.adults, parseChildrenAges(session)),
      lodge: session.unitGroupCode
        ? {
            unitGroupCode: session.unitGroupCode,
            ratePlanId: session.ratePlanId,
            stayGrossAmount: session.stayGrossAmount,
            currency: session.currency,
          }
        : null,
      extras,
      guest: session.guestFirstName
        ? {
            firstName: session.guestFirstName,
            lastName: session.guestLastName,
            email: session.guestEmail,
            phone: session.guestPhone,
            vehiclePlate: session.vehiclePlate,
          }
        : null,
      total,
    });
  });
}
