import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getFolioForReservation } from "@/server/apaleo/bookings";
import { parseChildrenAges, parseExtras } from "@/server/booking/session";
import { partyLabel } from "@/server/booking/party";
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
      include: {
        session: { include: { lodges: { orderBy: { slot: "asc" } } } },
        reservations: { orderBy: { slot: "asc" } },
      },
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

    // One live folio read per reservation, summed - "settled" is the whole
    // booking's word. Reads only, so no write budget spent.
    const reservationIds =
      record.reservations.length > 0
        ? record.reservations.map((r) => r.apaleoReservationId)
        : [record.apaleoReservationId];
    let folioBalance = 0;
    for (const reservationId of reservationIds) {
      const folio = await getFolioForReservation(reservationId);
      folioBalance += folio.balance;
    }

    const guestRows = (await loadGuests(record.sessionId)).map(guestRowDto);
    const lodges = record.session.lodges.map((l) => {
      // The location outcome lives on BookingReservation (written at
      // checkout); the request lives on SessionLodge. Join them by slot.
      const reservation = record.reservations.find((r) => r.slot === l.slot);
      const feeDropped = reservation?.locationFeeDropped ?? false;
      return {
        slot: l.slot,
        unitGroupCode: l.unitGroupCode,
        stayGrossAmount: l.stayGrossAmount,
        partyLabel: partyLabel(l.adults, parseChildrenAges(l)),
        extras: parseExtras(l),
        bands: partyBands(l),
        guests: guestRows.filter((r) => r.slot === l.slot),
        assignedUnitName: reservation?.assignedUnitName ?? null,
        requestedUnitName: l.locationUnitName,
        // Only a fee that actually survived to the folio is shown as paid.
        locationFee: feeDropped ? null : l.locationFee,
        locationFeeDropped: feeDropped,
      };
    });

    return NextResponse.json({
      bookingId: record.apaleoBookingId,
      reservationId: record.apaleoReservationId,
      status: record.status,
      paidAt: record.paidAt,
      totalGrossAmount: record.totalGrossAmount,
      currency: record.currency,
      folioBalance,
      account: { status: accountStatus },
      stay: {
        arrival: record.session.arrival,
        departure: record.session.departure,
        adults: record.session.adults,
        unitGroupCode: record.session.unitGroupCode,
        stayGrossAmount: record.session.stayGrossAmount,
      },
      lodges,
      extras: parseExtras(record.session),
      guest: {
        firstName: record.session.guestFirstName,
        lastName: record.session.guestLastName,
        email: record.session.guestEmail,
        vehiclePlate: record.session.vehiclePlate,
      },
    });
  });
}
