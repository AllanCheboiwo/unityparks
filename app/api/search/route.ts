import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStayOffers } from "@/server/apaleo/offers";
import { validateStay } from "@/server/booking/rules";
import { bandsToAges } from "@/server/booking/party";
import { createSession } from "@/server/booking/session";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

const PartyBody = z.object({
  adults: z.number().int().min(1).max(8),
  children: z.number().int().min(0).max(7).default(0),
  toddlers: z.number().int().min(0).max(7).default(0),
  infants: z.number().int().min(0).max(7).default(0),
});

const SearchBody = PartyBody.extend({
  arrival: z.string(),
  departure: z.string(),
  // Per-lodge parties for a multi-lodge break; when present, the flat party
  // fields above are ignored. One entry per lodge, up to three.
  lodges: z.array(PartyBody).min(1).max(3).optional(),
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
    const { arrival, departure, lodges, ...flatParty } = parsed.data;
    const partyInputs = lodges ?? [flatParty];

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

    const parties = partyInputs.map((p) => ({
      adults: p.adults,
      childrenAges: bandsToAges(p),
    }));
    // Each lodge is booked whole, so every party must fit one lodge.
    for (const [i, p] of parties.entries()) {
      const size = p.adults + p.childrenAges.length;
      if (size > 8) {
        return NextResponse.json(
          {
            refused: true,
            reason: `Our largest lodge sleeps 8. Lodge ${i + 1} has ${size} guests. Split the party differently or call our team.`,
          },
          { status: 422 },
        );
      }
    }

    const user = await getCurrentUser();
    // The response carries offers for the first lodge's party; the results
    // page fetches per-slot offers itself when there is more than one.
    const offers = await getStayOffers({
      arrival,
      departure,
      adults: parties[0].adults,
      childrenAges: parties[0].childrenAges,
    });
    const session = await createSession({
      arrival,
      departure,
      parties,
      userId: user?.id ?? null,
    });

    return NextResponse.json({
      sessionId: session.id,
      arrival,
      departure,
      adults: parties.reduce((sum, p) => sum + p.adults, 0),
      lodgeCount: parties.length,
      nights: stay.nights,
      offers,
    });
  });
}
