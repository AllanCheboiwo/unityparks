import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import {
  getSession,
  sessionSnapshotTotal,
  setReferralOnSession,
} from "@/server/booking/session";
import { getCurrentUser } from "@/server/auth/session";
import { findClaim } from "@/server/referral/claim";
import { refusalMessage, validateReferralCode } from "@/server/referral/validate";
import { capApplicableCredit, normalizeReferralCode } from "@/lib/referral";
import { handleRoute, jsonError } from "@/server/api-helpers";

/**
 * The pay step's referral code box. Like the credit toggle next to it, the
 * choice is stamped onto the session row rather than held in page state:
 * the pay page does not survive the Pesapal bounce, and checkout reads only
 * the session.
 *
 * The discount written here is advisory display only - ensureRecord
 * revalidates the code and recomputes the discount from config before any
 * money moves. Self-use is judged against the lead guest already saved at
 * the details step, which is better contact data than that step could offer.
 */

const ReferralBody = z.object({
  // Empty string means "clear it", the same semantics the details route
  // gives the field.
  code: z.string().trim().max(40),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    if (session.state === "completed") {
      return jsonError(409, "This booking is already confirmed. Start a new search to book another break.");
    }

    const parsed = ReferralBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid referral code.");
    const code = normalizeReferralCode(parsed.data.code);

    const cleared = { applied: false as const, code: null, discount: null };

    if (!code) {
      if (!(await setReferralOnSession(id, { code: null, discount: null }))) {
        return jsonError(409, "Your booking is already being confirmed. Press Buy now to finish.");
      }
      await reclampCredit(id, 0);
      return NextResponse.json(cleared);
    }

    const user = await getCurrentUser();
    const check = await validateReferralCode({
      code,
      guestEmail: session.guestEmail,
      guestPhone: session.guestPhone,
      sessionUserId: user?.id ?? null,
    });

    // A refused code clears the stamp, so what the guest sees and what
    // checkout would honour never disagree. Same rule as the details route.
    if (!check.ok) {
      if (!(await setReferralOnSession(id, { code: null, discount: null }))) {
        return jsonError(409, "Your booking is already being confirmed. Press Buy now to finish.");
      }
      await reclampCredit(id, 0);
      return NextResponse.json({ ...cleared, message: refusalMessage(check.reason) });
    }

    if (!(await setReferralOnSession(id, { code, discount: check.discount }))) {
      return jsonError(409, "Your booking is already being confirmed. Press Buy now to finish.");
    }
    await reclampCredit(id, check.discount);
    return NextResponse.json({ applied: true, code, discount: check.discount });
  });
}

/**
 * A bigger discount shrinks the room left for applied credit, so credit
 * stamped before the code went on can end up above the cap. Left alone, the
 * pay page would show a payable that checkout's own clamp then disagrees
 * with. Lower it here instead; the guest sees the smaller number before
 * pressing Buy now.
 *
 * Only the ordinary no-claim case: once a failed checkout has committed a
 * ledger claim, that amount is fixed and ensureRecord owns the clamping.
 */
async function reclampCredit(sessionId: string, discount: number): Promise<void> {
  const session = await getSession(sessionId);
  if (!session?.applyCredit || !session.creditAmount) return;
  if (await findClaim(sessionId)) return;
  const cap = capApplicableCredit({
    bookingTotal: sessionSnapshotTotal(session),
    discount,
    // The cap rule is about room on this booking, not the pool; the balance
    // is already known to cover what is stamped.
    vestedBalance: session.creditAmount,
  });
  if (cap >= session.creditAmount) return;
  await prisma.bookingSession.updateMany({
    where: { id: sessionId, booking: null },
    data: cap > 0 ? { creditAmount: cap } : { applyCredit: false, creditAmount: null },
  });
}
