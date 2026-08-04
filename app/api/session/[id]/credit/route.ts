import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
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

    // Freeze rule, same as the details route: once a record exists the
    // folio totals are frozen and a credit change could not be honoured.
    const existingRecord = await prisma.bookingRecord.findUnique({
      where: { sessionId: id },
      select: { id: true },
    });
    if (existingRecord) {
      return jsonError(409, "Your booking is already being confirmed. Press Buy now to finish.");
    }

    const parsed = CreditBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid credit request.");

    if (!parsed.data.apply) {
      await prisma.bookingSession.update({
        where: { id },
        data: { applyCredit: false, creditAmount: null },
      });
      return NextResponse.json({ applied: false, amount: null });
    }

    const available = await availableFor(session);
    if (available <= 0) {
      return jsonError(409, "You have no referral credit available for this booking.");
    }
    await prisma.bookingSession.update({
      where: { id },
      data: { applyCredit: true, creditAmount: available },
    });
    return NextResponse.json({ applied: true, amount: available });
  });
}
