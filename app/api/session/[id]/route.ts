import { NextRequest, NextResponse } from "next/server";
import { getSession, parseChildrenAges, parseExtras } from "@/server/booking/session";
import { computeTotal, nightsBetween } from "@/server/booking/rules";
import { partyLabel } from "@/server/booking/party";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { prisma } from "@/server/db";

/** Everything a funnel page needs to render this session's basket. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    let session = await getSession(id);
    if (!session) {
      // Same rule as checkout: once a booking record exists, the shopping
      // TTL no longer applies. A guest can sit on Pesapal's page past the
      // 30-minute mark; the pay page must still render so Buy now can
      // resume the reserved booking instead of stranding it.
      const record = await prisma.bookingRecord.findUnique({ where: { sessionId: id } });
      if (record) {
        session = await prisma.bookingSession.findUnique({
          where: { id },
          include: { lodges: { orderBy: { slot: "asc" } } },
        });
      }
    }
    if (!session) return jsonError(410, "Session expired.");

    const extras = parseExtras(session);
    // Whole-break display total: every lodge's stay, extras and location fee.
    // The location fee joins here explicitly; it is deliberately NOT part of
    // the extras JSON (the extras page overwrites that list wholesale).
    const total = session.lodges.some((l) => l.stayGrossAmount != null)
      ? session.lodges.reduce(
          (sum, l) =>
            sum +
            computeTotal(l.stayGrossAmount ?? 0, parseExtras(l)) +
            (l.locationFee ?? 0),
          0,
        )
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
        location: l.locationChoice
          ? {
              choice: l.locationChoice,
              unitId: l.locationUnitId,
              unitName: l.locationUnitName,
              fee: l.locationFee,
            }
          : null,
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
