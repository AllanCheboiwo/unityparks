import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getFolioForReservation } from "@/server/apaleo/bookings";
import { parseExtras } from "@/server/booking/session";
import { guestRowDto, loadGuests, partyBands } from "@/server/booking/guests";
import { assertBookingAccess } from "@/server/booking/access";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

/**
 * Confirmation data, driven by our recorded state (never a redirect) plus a
 * live folio read so "settled" is Apaleo's word, not ours. Proof of access
 * (cookie, ?session= from a fresh checkout, or ?email= from the challenge)
 * is checked before the Apaleo call so probes cost no API budget.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await prisma.bookingRecord.findFirst({
      where: { apaleoBookingId: bookingId },
      include: { session: true },
    });
    if (!record) return jsonError(404, "Booking not found.");

    const user = await getCurrentUser();
    assertBookingAccess(record, {
      user,
      sessionId: req.nextUrl.searchParams.get("session"),
      email: req.nextUrl.searchParams.get("email"),
    });

    // The confirmation page's account nudge: does this booking's viewer
    // have an account story to finish?
    let accountStatus: "ownedByYou" | "existingAccount" | "none";
    if (user && record.userId === user.id) {
      accountStatus = "ownedByYou";
    } else if (record.userId !== null) {
      accountStatus = "existingAccount";
    } else if (
      record.session.guestEmail &&
      (await prisma.user.findUnique({
        where: { email: record.session.guestEmail.toLowerCase() },
        select: { id: true },
      }))
    ) {
      accountStatus = "existingAccount";
    } else {
      accountStatus = "none";
    }

    const folio = await getFolioForReservation(record.apaleoReservationId);

    return NextResponse.json({
      bookingId: record.apaleoBookingId,
      reservationId: record.apaleoReservationId,
      status: record.status,
      paidAt: record.paidAt,
      totalGrossAmount: record.totalGrossAmount,
      currency: record.currency,
      folioBalance: folio.balance,
      account: { status: accountStatus },
      stay: {
        arrival: record.session.arrival,
        departure: record.session.departure,
        adults: record.session.adults,
        unitGroupCode: record.session.unitGroupCode,
        stayGrossAmount: record.session.stayGrossAmount,
      },
      extras: parseExtras(record.session),
      guest: {
        firstName: record.session.guestFirstName,
        lastName: record.session.guestLastName,
        email: record.session.guestEmail,
        vehiclePlate: record.session.vehiclePlate,
      },
      partyBands: partyBands(record.session),
      guests: (await loadGuests(record.sessionId)).map(guestRowDto),
    });
  });
}
