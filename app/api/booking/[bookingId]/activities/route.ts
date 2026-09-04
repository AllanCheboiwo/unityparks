import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { resolveBookingAccess } from "@/server/booking/access";
import { activitiesForRecord } from "@/server/inventory/availability";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

/**
 * Activities availability for a booked break (UNP-6): per lodge, every
 * active resource with its window, cap, owned count and free counts. A
 * local read, no Apaleo. Owners and accepted invitees may read; adding
 * goes through POST /extras, which stays owner-only by construction.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await prisma.bookingRecord.findFirst({
      where: { apaleoBookingId: bookingId },
      include: {
        session: { include: { lodges: { orderBy: { slot: "asc" } } } },
        reservations: { orderBy: { slot: "asc" } },
        invites: true,
      },
    });
    if (!record) return jsonError(404, "Booking not found.");
    resolveBookingAccess(record, {
      user: await getCurrentUser(),
      sessionId: req.nextUrl.searchParams.get("session"),
    });

    return NextResponse.json(await activitiesForRecord(record));
  });
}
