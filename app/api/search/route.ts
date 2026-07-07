import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStayOffers } from "@/server/apaleo/offers";
import { validateStay } from "@/server/booking/rules";
import { createSession } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

const SearchBody = z.object({
  arrival: z.string(),
  departure: z.string(),
  adults: z.number().int().min(1).max(8),
});

/**
 * The funnel's front door: validate the stay against the turnover rule,
 * fetch live offers, and open a booking session (the basket).
 * A 422 here is the demo's star moment — a Tuesday being refused.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = SearchBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please choose dates and party size.");
    const { arrival, departure, adults } = parsed.data;

    const stay = validateStay(arrival, departure);
    if (!stay.ok) {
      return NextResponse.json({ refused: true, reason: stay.reason }, { status: 422 });
    }

    const offers = await getStayOffers({ arrival, departure, adults });
    const session = await createSession({ arrival, departure, adults });

    return NextResponse.json({
      sessionId: session.id,
      arrival,
      departure,
      adults,
      nights: stay.nights,
      offers,
    });
  });
}
