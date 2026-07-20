import "server-only";
import { prisma } from "@/server/db";

/**
 * The memories counter. Unity Parks' goal is a billion happy memories, and
 * the site counts progress: one memory per guest per stay actually booked
 * and paid, no matter how many nights the stay runs. The count is real (paid
 * bookings in our database), plus a fixed baseline representing stays taken
 * before the counter existed.
 */

export const MEMORIES_GOAL = 1_000_000_000;

// Guests from before the counter shipped. A constant, not a fiction
// engine: the live number only moves when real paid bookings land.
const BASELINE_MEMORIES = 12_850;

function partySize(adults: number, childrenAges: string): number {
  try {
    const ages = JSON.parse(childrenAges);
    return adults + (Array.isArray(ages) ? ages.length : 0);
  } catch {
    return adults;
  }
}

/** Total memories made so far: baseline plus paid guests, one per stay. */
export async function countMemories(): Promise<number> {
  try {
    const paid = await prisma.bookingRecord.findMany({
      where: { status: "paid" },
      select: {
        session: {
          select: {
            adults: true,
            childrenAges: true,
            lodges: { select: { adults: true, childrenAges: true } },
          },
        },
      },
    });

    let guests = 0;
    for (const record of paid) {
      const s = record.session;
      // Multi-lodge sessions carry the real party per lodge; the legacy
      // single-lodge columns mirror slot 0, so use lodges when present.
      guests += s.lodges.length
        ? s.lodges.reduce((sum, l) => sum + partySize(l.adults, l.childrenAges), 0)
        : partySize(s.adults, s.childrenAges);
    }
    return BASELINE_MEMORIES + guests;
  } catch {
    // The counter is decoration, never a reason to fail a page render.
    return BASELINE_MEMORIES;
  }
}
