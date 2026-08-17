import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStayOffers } from "@/server/apaleo/offers";
import { bandsToAges } from "@/server/booking/party";
import { validateStay } from "@/server/booking/rules";
import { handleRoute, jsonError } from "@/server/api-helpers";

// Keep in step with BOOKING_HORIZON_DAYS in components/BookingBar.tsx.
const HORIZON_DAYS = 400;

const Query = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  nights: z.coerce.number().int(),
  dow: z.enum(["fri", "mon"]),
  adults: z.coerce.number().int().min(1).max(6),
  children: z.coerce.number().int().min(0).max(5),
  toddlers: z.coerce.number().int().min(0).max(5),
  infants: z.coerce.number().int().min(0).max(2),
});

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Whole-month availability: for one month, a break length and a start weekday,
 * price every candidate start date so the guest can pick from what's open.
 *
 * This is the one place we fan out several offer reads at once, about four or
 * five per month. They are reads, so they do not touch the tight write budget,
 * but the fan-out is the real cost, so it stays bounded to one month and the
 * browser caches the result.
 */
export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) return jsonError(400, "Invalid month search.");
    const { month, nights, dow, adults, children, toddlers, infants } = parsed.data;

    const targetDow = dow === "fri" ? 5 : 1;
    const today = new Date().toISOString().slice(0, 10);
    const horizonEnd = addDays(today, HORIZON_DAYS);
    const [year, mon] = month.split("-").map(Number);
    const childrenAges = bandsToAges({ children, toddlers, infants });

    // Candidate starts: matching weekdays in the month, inside the booking
    // window, whose break also ends on a turnover day.
    const candidates: Array<{ arrival: string; departure: string }> = [];
    for (let day = 1; day <= 31; day++) {
      const d = new Date(Date.UTC(year, mon - 1, day));
      if (d.getUTCMonth() !== mon - 1) break;
      if (d.getUTCDay() !== targetDow) continue;
      const arrival = d.toISOString().slice(0, 10);
      if (arrival < today || arrival > horizonEnd) continue;
      const departure = addDays(arrival, nights);
      if (validateStay(arrival, departure).ok) candidates.push({ arrival, departure });
    }

    const dates = await Promise.all(
      candidates.map(async ({ arrival, departure }) => {
        // Offers come back cheapest-first, so the first is the lead-in price.
        const offers = await getStayOffers({ arrival, departure, adults, childrenAges });
        const cheapest = offers[0] ?? null;
        return {
          arrival,
          departure,
          available: cheapest !== null,
          fromPrice: cheapest?.totalGrossAmount ?? null,
          currency: cheapest?.currency ?? "KES",
        };
      }),
    );

    return NextResponse.json({ dates });
  });
}
