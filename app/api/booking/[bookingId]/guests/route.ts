import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { saveGuests } from "@/server/booking/guests";
import { assertBookingAccess } from "@/server/booking/access";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

const GuestsBody = z.object({
  guests: z
    .array(
      z.object({
        position: z.number().int().min(0),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        dateOfBirth: z.string().optional(),
        email: z.string().trim().email().optional(),
      }),
    )
    .max(20),
  // Which lodge these guests stay in.
  slot: z.number().int().min(0).max(2).default(0),
});

/** Edit one lodge's guest manifest after booking, from the manage page.
 * Pure DB work: no Apaleo call anywhere on this path. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await prisma.bookingRecord.findFirst({
      where: { apaleoBookingId: bookingId },
      include: { session: { include: { lodges: { orderBy: { slot: "asc" } } } } },
    });
    if (!record) return jsonError(404, "Booking not found.");

    assertBookingAccess(record, {
      user: await getCurrentUser(),
      sessionId: req.nextUrl.searchParams.get("session"),
      email: req.nextUrl.searchParams.get("email"),
    });

    const parsed = GuestsBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please check the guest details.");
    const lodge = record.session.lodges.find((l) => l.slot === parsed.data.slot);
    if (!lodge) return jsonError(400, "That lodge slot is not part of this break.");

    await saveGuests(lodge, parsed.data.guests);
    return NextResponse.json({ ok: true });
  });
}
