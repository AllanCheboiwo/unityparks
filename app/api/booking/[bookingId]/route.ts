import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getFolioForReservation } from "@/server/apaleo/bookings";
import { parseChildrenAges, parseExtras, parseVehiclePlates } from "@/server/booking/session";
import { partyLabel } from "@/server/booking/party";
import { guestRowDto, loadGuests, partyBands } from "@/server/booking/guests";
import { resolveBookingAccess } from "@/server/booking/access";
import { redactBookingForInvitee } from "@/server/booking/invites";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

/** The credit actually posted onto this booking: the unreleased ledger
 * spend row for its session, or null. A released spend means the guest
 * detached the credit before the record existed, so nothing was posted. */
async function creditAppliedFor(sessionId: string): Promise<number | null> {
  const spend = await prisma.referralLedgerEntry.findUnique({
    where: { spentOnSessionId: sessionId },
    select: { amount: true, releasedAt: true },
  });
  if (!spend || spend.releasedAt) return null;
  return Math.round(Math.abs(spend.amount));
}

/**
 * Confirmation data, driven by our recorded state (never a redirect) plus a
 * live folio read so "settled" is Apaleo's word, not ours. Proof of access
 * (cookie, or ?session= from a fresh checkout) is checked before the Apaleo
 * call so probes cost no API budget.
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
        referralAttribution: { include: { participant: { select: { code: true } } } },
        invites: true,
      },
    });
    if (!record) return jsonError(404, "Booking not found.");

    const user = await getCurrentUser();
    const { role } = resolveBookingAccess(record, {
      user,
      sessionId: req.nextUrl.searchParams.get("session"),
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
    if (role === "owner") {
      for (const reservationId of reservationIds) {
        const folio = await getFolioForReservation(reservationId);
        folioBalance += folio.balance;
      }
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
        locationChoice: l.locationChoice,
        requestedUnitName: l.locationUnitName,
        // Only a fee that actually survived to the folio is shown as paid.
        locationFee: feeDropped ? null : l.locationFee,
        locationFeeDropped: feeDropped,
      };
    });

    const dto = {
      role,
      bookingId: record.apaleoBookingId,
      reservationId: record.apaleoReservationId,
      status: record.status,
      paidAt: record.paidAt,
      cancelledAt: record.cancelledAt,
      refundAmount: record.refundAmount,
      totalGrossAmount: record.totalGrossAmount,
      currency: record.currency,
      depositAmount: record.depositAmount,
      balanceDueDate: record.balanceDueDate,
      // Legacy fallback: records from before the deposit feature store
      // paidAmount 0 while being fully paid. Report the truth here so no
      // client ever computes a phantom outstanding balance.
      paidAmount:
        record.status === "paid" && record.paidAmount === 0
          ? record.totalGrossAmount
          : record.paidAmount,
      folioBalance,
      account: { status: accountStatus },
      // The referral discount that was posted to the folios at checkout, so
      // the itemised lodge lines reconcile with the (discounted) total and
      // the guest sees their discount applied. Credit applied by the buyer
      // shows through the same surface, read from the ledger spend row (the
      // money truth), never the session's advisory flags, which can drift
      // from the folios under toggle-vs-Buy-now races.
      referral: record.referralAttribution
        ? {
            code: record.referralAttribution.participant.code,
            discount: record.referralAttribution.discountAmount,
          }
        : null,
      creditApplied: await creditAppliedFor(record.sessionId),
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
        vehiclePlates: parseVehiclePlates(record.session),
      },
    };
    // An invitee gets the allow-listed view and nothing else; the frozen
    // suite pins what survives this call.
    if (role === "invitee") {
      return NextResponse.json({
        role,
        ...redactBookingForInvitee(dto, user!.email),
      });
    }
    return NextResponse.json(dto);
  });
}
