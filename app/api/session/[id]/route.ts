import { NextRequest, NextResponse } from "next/server";
import { getSession, parseExtras } from "@/server/booking/session";
import { computeTotal, nightsBetween } from "@/server/booking/rules";
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

    return NextResponse.json({
      sessionId: session.id,
      state: session.state,
      arrival: session.arrival,
      departure: session.departure,
      nights: nightsBetween(session.arrival, session.departure),
      adults: session.adults,
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
