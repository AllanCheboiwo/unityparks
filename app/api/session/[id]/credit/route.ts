import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { findClaim, isLiveClaim, releaseClaim } from "@/server/referral/claim";
import { getSession, parseExtras } from "@/server/booking/session";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { vestedCreditBalance } from "@/server/referral/derive";
import { capApplicableCredit } from "@/lib/referral";

/**
 * The pay step's credit offer. GET answers "how much could this guest apply
 * here"; POST stamps the choice onto the session row, because the pay
 * page's own state does not survive the Pesapal bounce and checkout reads
 * only the session. Both numbers are advisory: ensureRecord re-derives the
 * balance authoritatively inside the spend-claim transaction and clamps.
 */

/** The session-snapshot total the cap rule works against. */
function snapshotTotal(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): number {
  return session.lodges.reduce(
    (sum, l) =>
      sum +
      (l.stayGrossAmount ?? 0) +
      parseExtras(l).reduce((a, e) => a + e.grossAmount, 0) +
      (l.locationFee ?? 0),
    0,
  );
}

async function availableFor(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<number> {
  const user = await getCurrentUser();
  if (!user || session.userId !== user.id) return 0;
  const participant = await prisma.referralParticipant.findUnique({
    where: { userId: user.id },
  });
  if (!participant || participant.revokedAt) return 0;
  // This session's one claim slot decides what is still possible here, so
  // the pay page never offers a box whose every click would be refused: a
  // released slot is burned for this booking, and a live claim belonging
  // to someone else is not this guest's to re-arm.
  const claim = await findClaim(session.id);
  if (claim) {
    if (claim.releasedAt) return 0;
    if (claim.participantId !== participant.id) return 0;
    return Math.round(Math.abs(claim.amount));
  }
  const vested = await vestedCreditBalance(participant.id);
  return capApplicableCredit({
    bookingTotal: snapshotTotal(session),
    discount: session.referralDiscount ?? 0,
    vestedBalance: vested,
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    return NextResponse.json({
      available: await availableFor(session),
      applied: session.applyCredit,
      amount: session.creditAmount,
    });
  });
}

const CreditBody = z.object({ apply: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");

    const parsed = CreditBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid credit request.");

    // A failed checkout attempt may already have claimed this session's
    // credit (the claim commits before the folio work). The claim, not the
    // session flag, is authoritative for money, so toggling must deal with
    // it: off releases it, on adopts it. releaseClaim's guarded write on
    // the claim row is what makes "off" safe against a checkout that is in
    // flight right now: whoever writes first wins, and a claim already
    // committed to a folio refuses to be released.
    const claim = await findClaim(id);
    const live = isLiveClaim(claim) ? claim : null;

    if (!parsed.data.apply) {
      if (live) {
        const released = await releaseClaim(live);
        if (!released) {
          // Committed to a folio: the credit is on the bill now. Finishing
          // and cancelling returns it (a cancelled booking's spend stops
          // counting); abandoning leaves it for us to release from ops.
          return jsonError(
            409,
            "Your credit is already on this booking's bill. Finish the payment (cancelling later returns the credit), or contact us to undo it.",
          );
        }
      }
      // Freeze rule folded into the write itself (check-then-act raced the
      // record create): count 0 means a record landed and the session is
      // frozen.
      const cleared = await prisma.bookingSession.updateMany({
        where: { id, booking: null },
        data: { applyCredit: false, creditAmount: null },
      });
      if (cleared.count === 0) {
        return jsonError(409, "Your booking is already being confirmed. Press Buy now to finish.");
      }
      return NextResponse.json({ applied: false, amount: null });
    }

    if (claim && !live) {
      // The claim slot for this session is spent-and-released; a fresh
      // claim cannot reuse it (spentOnSessionId is one-per-session, ever).
      return jsonError(
        409,
        "Referral credit was removed from this booking earlier and can't be re-applied here. It remains available for your next booking.",
      );
    }

    let amount: number;
    if (live) {
      // Only the account that made the claim may re-arm it; a shared
      // machine can have signed a different guest into this walk since.
      const user = await getCurrentUser();
      const owner = await prisma.referralParticipant.findUnique({
        where: { id: live.participantId },
        select: { userId: true },
      });
      if (!user || !owner?.userId || owner.userId !== user.id) {
        return jsonError(403, "That referral credit belongs to a different account.");
      }
      amount = Math.round(Math.abs(live.amount));
    } else {
      amount = await availableFor(session);
    }
    if (amount <= 0) {
      return jsonError(409, "You have no referral credit available for this booking.");
    }
    const stamped = await prisma.bookingSession.updateMany({
      where: { id, booking: null },
      data: { applyCredit: true, creditAmount: amount },
    });
    if (stamped.count === 0) {
      return jsonError(409, "Your booking is already being confirmed. Press Buy now to finish.");
    }
    return NextResponse.json({ applied: true, amount });
  });
}
