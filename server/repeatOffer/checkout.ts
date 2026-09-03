import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { PublicError } from "../api-helpers";
import { postAllowance } from "../apaleo/payments";
import { planInstrumentAllowances, snapshotBases } from "../booking/instrument";
import { type SessionWithLodges } from "../booking/session";
import { capOfferDiscount, offerDiscountFor } from "@/lib/repeatOffer";
import { decideClaim, type ClaimDecision } from "./claim";
import { pendingRedemptionForSession, propertyTodayIso, stayFactsById } from "./derive";

/**
 * The repeat-guest moment inside ensureRecord: the second instrument on
 * the seam the referral engine proved (docs/promo-codes-plan.md section
 * 6). Runs strictly after unit assignment and strictly before the
 * folio-balance reads that freeze the booking's totals. The pure decision
 * lives in ./claim.ts; this executor writes the redemption row, posts the
 * allowances, and hands back the row id for the confirm that happens with
 * the record create.
 *
 * Replay safety is the same package as referral's: deterministic bases,
 * per-slot idempotency keys (up-repeat-<sessionId>-<slot>), Apaleo's 24h
 * dedup, plus the adopt rule: a live PENDING row is the money truth and is
 * never re-litigated.
 */

export type RepeatOfferAtCheckout = {
  /** The PENDING redemption to confirm once the record exists, or null. */
  redemptionId: string | null;
  /** Whether any allowance was posted (folios must be re-read for totals). */
  postedAllowances: boolean;
};

const NOTHING: RepeatOfferAtCheckout = { redemptionId: null, postedAllowances: false };

async function clearOfferSnapshot(sessionId: string): Promise<void> {
  await prisma.bookingSession.updateMany({
    where: { id: sessionId, booking: null },
    data: { repeatOfferRecordId: null, repeatOfferDiscount: null },
  });
}

type RefusalReason = Extract<ClaimDecision, { action: "refuse" }>["reason"];

const REFUSAL_MESSAGE: Record<RefusalReason, string> = {
  foreign_claim:
    "This booking already has a repeat-guest offer applied by another account. Please start a new search.",
  signed_out:
    "Please sign in to use your repeat-guest offer. It has been removed - review your total and press Buy now again.",
  stay_not_eligible:
    "Your repeat-guest offer is no longer available. It has been removed - please review your total and press Buy now again.",
  window_closed:
    "Your repeat-guest offer window has closed. The discount has been removed - please review your total and press Buy now again.",
  not_member:
    "Your repeat-guest offer is no longer available. It has been removed - please review your total and press Buy now again.",
  discount_changed:
    "Your repeat-guest discount changed with your booking. It has been removed - re-apply it on the pay step if you wish, and press Buy now again.",
};

export async function applyRepeatOfferAtCheckout(input: {
  session: SessionWithLodges;
  /** Per-slot outcome of assignUnits; a dropped fee shrinks the bases. */
  feeDroppedBySlot: boolean[];
  folios: Array<{ folioId: string; currency: string }>;
  /** Whether the referral instrument put a code discount on this booking. */
  referralDiscountApplied: boolean;
}): Promise<RepeatOfferAtCheckout> {
  const { session, folios } = input;

  // Adopt-don't-post, same as referral: a racing tab's record froze its
  // totals without our allowances.
  const raced = await prisma.bookingRecord.findUnique({
    where: { sessionId: session.id },
    select: { id: true },
  });
  if (raced) return NOTHING;

  const pendingRow = await pendingRedemptionForSession(session.id);
  const snapshot =
    session.repeatOfferRecordId != null && session.repeatOfferDiscount != null
      ? {
          earnedByRecordId: session.repeatOfferRecordId,
          discount: session.repeatOfferDiscount,
        }
      : null;
  if (!pendingRow && !snapshot) return NOTHING;

  // One discount instrument per booking (spec decision 7). The route guard
  // makes this unreachable in the UI; the belt stays because the details
  // step can stamp a code after the offer was applied.
  if (!pendingRow && snapshot && input.referralDiscountApplied) {
    await clearOfferSnapshot(session.id);
    throw new PublicError(
      409,
      "A referral code and the repeat-guest offer cannot ride one booking. The offer has been removed - please review your total and press Buy now again.",
    );
  }

  const bases = snapshotBases(session, input.feeDroppedBySlot);
  const totalBase = bases.reduce((sum, b) => sum + b, 0);
  const recomputedDiscount = capOfferDiscount({
    bookingTotal: totalBase,
    discount: offerDiscountFor(session.lodges.length),
  });

  const decision = decideClaim({
    sessionUserId: session.userId,
    snapshot,
    pending: pendingRow
      ? {
          id: pendingRow.id,
          claimantUserId: pendingRow.claimantUserId,
          earnedByRecordId: pendingRow.earnedByRecordId,
          amount: pendingRow.amount,
        }
      : null,
    stay: snapshot ? await stayFactsById(snapshot.earnedByRecordId) : null,
    recomputedDiscount,
    todayIso: propertyTodayIso(),
  });

  if (decision.action === "none") return NOTHING;
  if (decision.action === "refuse") {
    // The honest path: snapshot cleared, totals re-render, the guest
    // re-reads before paying. Silently proceeding undiscounted is
    // forbidden (spec section 9).
    await clearOfferSnapshot(session.id);
    throw new PublicError(409, REFUSAL_MESSAGE[decision.reason]);
  }

  let redemptionId: string;
  let amount: number;
  let earnedByRecordId: string;
  if (decision.action === "adopt") {
    redemptionId = decision.redemptionId;
    amount = decision.amount;
    earnedByRecordId = pendingRow!.earnedByRecordId;
  } else {
    try {
      const created = await prisma.repeatGuestRedemption.create({
        data: {
          sessionId: session.id,
          earnedByRecordId: decision.earnedByRecordId,
          claimantUserId: session.userId!,
          amount: decision.amount,
          status: "PENDING",
        },
      });
      redemptionId = created.id;
      amount = created.amount;
      earnedByRecordId = created.earnedByRecordId;
    } catch (err) {
      // Two tabs racing Buy now: the loser adopts the winner's row when it
      // belongs to the same account, exactly like the record create race.
      const racedRow =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
          ? await prisma.repeatGuestRedemption.findUnique({
              where: { sessionId: session.id },
            })
          : null;
      if (
        !racedRow ||
        racedRow.status !== "PENDING" ||
        racedRow.claimantUserId !== session.userId
      ) {
        if (racedRow) {
          await clearOfferSnapshot(session.id);
          throw new PublicError(409, REFUSAL_MESSAGE.foreign_claim);
        }
        throw err;
      }
      redemptionId = racedRow.id;
      amount = racedRow.amount;
      earnedByRecordId = racedRow.earnedByRecordId;
    }
  }

  const planned = planInstrumentAllowances({
    instrument: "repeat",
    sessionId: session.id,
    amount,
    bases,
    folios,
    reasonRef: earnedByRecordId,
  });
  for (const post of planned) {
    await postAllowance({
      folioId: post.folioId,
      amount: post.amount,
      currency: post.currency,
      reason: post.reason,
      idempotencyKey: post.idempotencyKey,
    });
  }

  return { redemptionId, postedAllowances: true };
}

/** Flip the claim to CONFIRMED in the same local step that records the
 * booking. Conditional on PENDING plus the unique bookingRecordId, so a
 * crash replay converges on exactly one CONFIRMED row per booking. */
export async function confirmRedemption(
  redemptionId: string,
  bookingRecordId: string,
): Promise<void> {
  await prisma.repeatGuestRedemption.updateMany({
    where: { id: redemptionId, status: "PENDING" },
    data: { status: "CONFIRMED", bookingRecordId },
  });
}

/**
 * The existing-record path's reconcile, like reconcileCreditFlags: heal a
 * crash that landed between the record create and the confirm, then make
 * the frozen session's display flags agree with the redemption ledger.
 */
export async function reconcileOfferFlags(sessionId: string): Promise<void> {
  const record = await prisma.bookingRecord.findUnique({
    where: { sessionId },
    select: { id: true },
  });
  let row = await prisma.repeatGuestRedemption.findUnique({ where: { sessionId } });
  if (record && row && row.status === "PENDING") {
    await confirmRedemption(row.id, record.id);
    row = await prisma.repeatGuestRedemption.findUnique({ where: { sessionId } });
  }
  const confirmed = row && row.status === "CONFIRMED" ? row : null;
  await prisma.bookingSession.update({
    where: { id: sessionId },
    data: confirmed
      ? {
          repeatOfferRecordId: confirmed.earnedByRecordId,
          repeatOfferDiscount: confirmed.amount,
        }
      : { repeatOfferRecordId: null, repeatOfferDiscount: null },
  });
}
