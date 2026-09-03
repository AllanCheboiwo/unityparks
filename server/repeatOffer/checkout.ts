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
 * 6). Split in two so every refusal fires before ANY instrument touches a
 * folio (2 Sep review finding: a refusal thrown after the referral posts
 * would strand its allowances on a recordless checkout):
 *
 * 1. decideRepeatOfferAtCheckout: reads, the claim decision, every honest
 *    refusal, and the PENDING row insert. Database only, no Apaleo.
 * 2. executeRepeatOffer: posts the decided allowances. Runs after the
 *    referral instrument, strictly before the freezing folio re-read.
 *
 * Replay safety is the same package as referral's: deterministic bases,
 * per-slot idempotency keys (up-repeat-<sessionId>-<slot>), Apaleo's 24h
 * dedup, plus the adopt rule: a live PENDING row is the money truth and is
 * never re-litigated.
 */

export type RepeatOfferDecision =
  | { kind: "none" }
  | {
      kind: "post";
      redemptionId: string;
      amount: number;
      earnedByRecordId: string;
    };

export type RepeatOfferAtCheckout = {
  /** The PENDING redemption to confirm once the record exists, or null. */
  redemptionId: string | null;
  /** Whether any allowance was posted (folios must be re-read for totals). */
  postedAllowances: boolean;
};

const NOTHING: RepeatOfferAtCheckout = { redemptionId: null, postedAllowances: false };

/** The freeze-guarded snapshot clear, shared with the session routes.
 * Returns false when the freeze refused it (a record exists). */
export async function clearOfferSnapshot(sessionId: string): Promise<boolean> {
  const cleared = await prisma.bookingSession.updateMany({
    where: { id: sessionId, booking: null },
    data: { repeatOfferRecordId: null, repeatOfferDiscount: null },
  });
  return cleared.count > 0;
}

type RefusalReason = Extract<ClaimDecision, { action: "refuse" }>["reason"];

const REFUSAL_MESSAGE: Record<RefusalReason | "code_conflict" | "stale_claim", string> = {
  foreign_claim:
    "This booking already has a repeat-guest offer applied by another account. Please start a new search.",
  stale_claim:
    "Your earlier repeat-guest offer on this booking could not be recovered. It has been removed - please review your total and press Buy now again.",
  code_conflict:
    "A referral code and the repeat-guest offer cannot ride one booking. Remove the code at the details step, then press Buy now again.",
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

export async function decideRepeatOfferAtCheckout(input: {
  session: SessionWithLodges;
  /** Per-slot outcome of assignUnits; a dropped fee shrinks the bases. */
  feeDroppedBySlot: boolean[];
}): Promise<RepeatOfferDecision> {
  const { session } = input;

  // Adopt-don't-post, same as referral: a racing tab's record froze its
  // totals without our allowances.
  const raced = await prisma.bookingRecord.findUnique({
    where: { sessionId: session.id },
    select: { id: true },
  });
  if (raced) return { kind: "none" };

  const pendingRow = await pendingRedemptionForSession(session.id);
  const snapshot =
    session.repeatOfferRecordId != null && session.repeatOfferDiscount != null
      ? {
          earnedByRecordId: session.repeatOfferRecordId,
          discount: session.repeatOfferDiscount,
        }
      : null;
  if (!pendingRow && !snapshot) return { kind: "none" };

  // One discount instrument per booking (spec decision 7), decided before
  // anything is posted. The stamped code is enough to refuse on: even an
  // invalid one is about to be re-validated by the referral instrument,
  // and the guest resolves either way by removing it at details.
  if (session.referralCode) {
    throw new PublicError(409, REFUSAL_MESSAGE.code_conflict);
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

  if (decision.action === "none") return { kind: "none" };
  if (decision.action === "refuse") {
    // The honest path: snapshot cleared, totals re-render, the guest
    // re-reads before paying. Silently proceeding undiscounted is
    // forbidden (spec section 9). Nothing has been posted yet.
    await clearOfferSnapshot(session.id);
    throw new PublicError(409, REFUSAL_MESSAGE[decision.reason]);
  }

  if (decision.action === "adopt") {
    return {
      kind: "post",
      redemptionId: decision.redemptionId,
      amount: decision.amount,
      earnedByRecordId: pendingRow!.earnedByRecordId,
    };
  }

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
    return {
      kind: "post",
      redemptionId: created.id,
      amount: created.amount,
      earnedByRecordId: created.earnedByRecordId,
    };
  } catch (err) {
    const racedRow =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
        ? await prisma.repeatGuestRedemption.findUnique({
            where: { sessionId: session.id },
          })
        : null;
    if (!racedRow) throw err;
    if (racedRow.status === "PENDING" && racedRow.claimantUserId === session.userId) {
      // Two tabs racing Buy now: the loser adopts the winner's row.
      return {
        kind: "post",
        redemptionId: racedRow.id,
        amount: racedRow.amount,
        earnedByRecordId: racedRow.earnedByRecordId,
      };
    }
    await clearOfferSnapshot(session.id);
    if (racedRow.claimantUserId !== session.userId) {
      throw new PublicError(409, REFUSAL_MESSAGE.foreign_claim);
    }
    // The session's own row, but swept (RELEASED) or already spent: its
    // crashed allowances may sit on folios past the dedup boundary, so
    // re-claiming here could double-post. Refuse honestly instead.
    throw new PublicError(409, REFUSAL_MESSAGE.stale_claim);
  }
}

export async function executeRepeatOffer(input: {
  session: SessionWithLodges;
  feeDroppedBySlot: boolean[];
  folios: Array<{ folioId: string; currency: string }>;
  decision: RepeatOfferDecision;
}): Promise<RepeatOfferAtCheckout> {
  if (input.decision.kind === "none") return NOTHING;

  const bases = snapshotBases(input.session, input.feeDroppedBySlot);
  const planned = planInstrumentAllowances({
    instrument: "repeat",
    sessionId: input.session.id,
    amount: input.decision.amount,
    bases,
    folios: input.folios,
    reasonRef: input.decision.earnedByRecordId,
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
  return { redemptionId: input.decision.redemptionId, postedAllowances: true };
}

/** Flip the claim to CONFIRMED in the same local step that records the
 * booking. The write wins over the ops sweep regardless of order: a row
 * the sweep flipped to RELEASED between our adopt read and this call is
 * reclaimed, because its allowances are on the frozen folios (2 Sep
 * review finding). bookingRecordId's uniqueness keeps replay convergent. */
export async function confirmRedemption(
  redemptionId: string,
  bookingRecordId: string,
): Promise<void> {
  const confirmed = await prisma.repeatGuestRedemption.updateMany({
    where: {
      id: redemptionId,
      bookingRecordId: null,
      status: { in: ["PENDING", "RELEASED"] },
    },
    data: { status: "CONFIRMED", bookingRecordId },
  });
  if (confirmed.count === 0) {
    // Already confirmed (replay), or something genuinely unexpected.
    // Loud either way; the invariant checker is the ops read-out.
    console.error(
      `[repeat-offer] confirm matched no row: redemption ${redemptionId}, record ${bookingRecordId}`,
    );
  }
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
  if (record && row && row.bookingRecordId == null && row.status !== "CONFIRMED") {
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
