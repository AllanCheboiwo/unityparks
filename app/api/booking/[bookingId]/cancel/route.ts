import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertBookingAccess } from "@/server/booking/access";
import { cancelBooking, quoteCancellation } from "@/server/booking/cancellation";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

/**
 * Self-serve cancellation. GET quotes what a cancellation would refund
 * right now (pure read, no Apaleo calls); POST executes it. Both demand
 * the same proof of access as every other booking endpoint.
 */

async function loadRecord(bookingId: string) {
  return prisma.bookingRecord.findFirst({
    where: { apaleoBookingId: bookingId },
    include: {
      session: { include: { lodges: { orderBy: { slot: "asc" } } } },
      reservations: { orderBy: { slot: "asc" } },
    },
  });
}

function proofFrom(req: NextRequest) {
  return {
    sessionId: req.nextUrl.searchParams.get("session"),
    email: req.nextUrl.searchParams.get("email"),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await loadRecord(bookingId);
    if (!record) return jsonError(404, "Booking not found.");
    assertBookingAccess(record, { user: await getCurrentUser(), ...proofFrom(req) });
    return NextResponse.json(quoteCancellation(record));
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await loadRecord(bookingId);
    if (!record) return jsonError(404, "Booking not found.");
    assertBookingAccess(record, { user: await getCurrentUser(), ...proofFrom(req) });
    const outcome = await cancelBooking(record);
    return NextResponse.json({ ok: true, ...outcome });
  });
}
