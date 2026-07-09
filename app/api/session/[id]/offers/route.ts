import { NextRequest, NextResponse } from "next/server";
import { getStayOffers } from "@/server/apaleo/offers";
import { getSession, parseChildrenAges } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

/**
 * Live lodge offers for one lodge of this session's break (?slot=, default
 * 0), priced for that lodge's own party. Refetched (not cached from search)
 * so the results page is refreshable and always shows real availability.
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

    const offers = await getStayOffers({
      arrival: session.arrival,
      departure: session.departure,
      adults: lodge.adults,
      childrenAges: parseChildrenAges(lodge),
    });
    return NextResponse.json({ offers, slot });
  });
}
