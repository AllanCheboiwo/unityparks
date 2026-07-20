import "server-only";
import { prisma } from "@/server/db";

/**
 * The memories counter. Unity Parks' goal is a billion happy memories, and
 * the site counts progress: one memory per guest per night actually booked
 * and paid. The count is real (paid bookings in our database), plus a fixed
 * baseline representing stays taken before the counter existed.
 */

export const MEMORIES_GOAL = 1_000_000_000;

// Guest-nights from before the counter shipped. A constant, not a fiction
// engine: the live number only moves when real paid bookings land.
const BASELINE_MEMORIES = 12_850;

function nightsBetween(arrival: string, departure: string): number {
  const a = new Date(`${arrival}T00:00:00Z`).getTime();
  const d = new Date(`${departure}T00:00:00Z`).getTime();
  const nights = Math.round((d - a) / 86_400_000);
  return nights > 0 ? nights : 0;
}

function partySize(adults: number, childrenAges: string): number {
  try {
    const ages = JSON.parse(childrenAges);
    return adults + (Array.isArray(ages) ? ages.length : 0);
  } catch {
    return adults;
  }
}

/** Total memories made so far: baseline plus paid guest-nights. */
export async function countMemories(): Promise<number> {
  try {
    const paid = await prisma.bookingRecord.findMany({
      where: { status: "paid" },
      select: {
        session: {
          select: {
            arrival: true,
            departure: true,
            adults: true,
            childrenAges: true,
            lodges: { select: { adults: true, childrenAges: true } },
          },
        },
      },
    });

    let guestNights = 0;
    for (const record of paid) {
      const s = record.session;
      const nights = nightsBetween(s.arrival, s.departure);
      // Multi-lodge sessions carry the real party per lodge; the legacy
      // single-lodge columns mirror slot 0, so use lodges when present.
      const guests = s.lodges.length
        ? s.lodges.reduce((sum, l) => sum + partySize(l.adults, l.childrenAges), 0)
        : partySize(s.adults, s.childrenAges);
      guestNights += guests * nights;
    }
    return BASELINE_MEMORIES + guestNights;
  } catch {
    // The counter is decoration, never a reason to fail a page render.
    return BASELINE_MEMORIES;
  }
}
