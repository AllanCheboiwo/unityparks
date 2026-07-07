import { NextRequest, NextResponse } from "next/server";
import { getStayOffers } from "@/server/apaleo/offers";
import { getSession } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

/**
 * Live lodge offers for this session's stay. Refetched (not cached from
 * search) so the results page is refreshable and always shows real
 * availability.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");

    const offers = await getStayOffers({
      arrival: session.arrival,
      departure: session.departure,
      adults: session.adults,
    });
    return NextResponse.json({ offers });
  });
}
