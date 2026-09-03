import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession, sessionSnapshotTotal } from "@/server/booking/session";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { offerForUser, pendingRedemptionForSession } from "@/server/repeatOffer/derive";
import { clearOfferSnapshot } from "@/server/repeatOffer/checkout";
import { capOfferDiscount, offerDiscountFor } from "@/lib/repeatOffer";

/**
 * The pay step's repeat-guest offer card. GET answers "does this signed-in
 * guest hold the offer, and what is it worth on this basket"; POST stamps
 * the Apply choice onto the session row, because the pay page's own state
 * does not survive the Pesapal bounce and checkout reads only the session.
 * Both numbers are advisory: the claim re-derives eligibility and amount
 * authoritatively inside checkout (server/repeatOffer/claim.ts).
 */

async function offerAmountFor(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<{ earnedByRecordId: string; amount: number; deadline: string } | null> {
  const user = await getCurrentUser();
  // The offer belongs to the signed-in identity that owns this walk.
  if (!user || session.userId !== user.id) return null;
  const offer = await offerForUser(user.id);
  if (!offer) return null;
  // Applied referral credit eats offer room, mirroring the credit route
  // subtracting the offer: one joint KSh 500 floor (invariant 4).
  const creditApplied =
    session.applyCredit && session.creditAmount != null ? session.creditAmount : 0;
  const amount = capOfferDiscount({
    bookingTotal: sessionSnapshotTotal(session) - creditApplied,
    discount: offerDiscountFor(session.lodges.length),
  });
  if (amount <= 0) return null;
  return { earnedByRecordId: offer.earnedByRecordId, amount, deadline: offer.deadline };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    // Applied state is deliberately absent: the session summary
    // (/api/session/[id] repeatOffer) is the one source the UI trusts.
    return NextResponse.json({ available: await offerAmountFor(session) });
  });
}

const OfferBody = z.object({ apply: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");

    const parsed = OfferBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid offer request.");

    // A PENDING redemption means a checkout attempt already put (or is
    // putting) the allowance on the folios. The row is the money truth;
    // the snapshot must not be toggled out from under it.
    const pending = await pendingRedemptionForSession(id);
    if (pending) {
      return jsonError(
        409,
        "Your offer is already on this booking's bill. Press Buy now to finish.",
      );
    }

    if (!parsed.data.apply) {
      // Freeze rule folded into the write itself (check-then-act would race
      // the record create): a refusal means a record landed.
      if (!(await clearOfferSnapshot(id))) {
        return jsonError(409, "Your booking is already being confirmed. Press Buy now to finish.");
      }
      return NextResponse.json({ applied: false, amount: null });
    }

    // One discount instrument per booking (spec decision 7). Referral
    // credit is settled money and stays combinable; the code is not.
    if (session.referralCode) {
      return jsonError(
        409,
        "This booking already carries a referral code. Remove it at the details step to use your repeat-guest offer.",
      );
    }

    const offer = await offerAmountFor(session);
    if (!offer) {
      return jsonError(409, "You have no repeat-guest offer available for this booking.");
    }
    const stamped = await prisma.bookingSession.updateMany({
      where: { id, booking: null },
      data: {
        repeatOfferRecordId: offer.earnedByRecordId,
        repeatOfferDiscount: offer.amount,
      },
    });
    if (stamped.count === 0) {
      return jsonError(409, "Your booking is already being confirmed. Press Buy now to finish.");
    }
    return NextResponse.json({ applied: true, amount: offer.amount });
  });
}
