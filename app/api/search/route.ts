import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStayOffers } from "@/server/apaleo/offers";
import { validateStay } from "@/server/booking/rules";
import { bandsToAges } from "@/server/booking/party";
import { createSession } from "@/server/booking/session";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

const SearchBody = z.object({
  arrival: z.string(),
  departure: z.string(),
  adults: z.number().int().min(1).max(8),
  children: z.number().int().min(0).max(7).default(0),
  toddlers: z.number().int().min(0).max(7).default(0),
  infants: z.number().int().min(0).max(7).default(0),
});

/**
 * The funnel's front door: validate the stay against the turnover rule,
 * fetch live offers, and open a booking session (the basket).
 * A 422 here is the demo's star moment - a Tuesday being refused.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = SearchBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please choose dates and party size.");
    const { arrival, departure, adults, children, toddlers, infants } = parsed.data;

    const today = new Date().toISOString().slice(0, 10);
    if (arrival < today) {
      return NextResponse.json(
        { refused: true, reason: "That arrival date has already passed. Pick an upcoming Friday or Monday." },
        { status: 422 },
      );
    }
    const stay = validateStay(arrival, departure);
    if (!stay.ok) {
      return NextResponse.json({ refused: true, reason: stay.reason }, { status: 422 });
    }

    const childrenAges = bandsToAges({ children, toddlers, infants });
    const user = await getCurrentUser();
    const offers = await getStayOffers({ arrival, departure, adults, childrenAges });
    const session = await createSession({
      arrival,
      departure,
      adults,
      childrenAges,
      userId: user?.id ?? null,
    });

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
