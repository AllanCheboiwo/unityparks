import "server-only";
import { isOfferWindowOpen } from "@/lib/repeatOffer";
import { isVerifiedMember, type StayFacts } from "./eligibility";

/**
 * The claim decision (docs/promo-codes-plan.md, section 9). Pure policy:
 * the executor loads the context, this answers adopt, claim, refuse or
 * none, and the executor writes rows and posts allowances.
 *
 * The one rule everything bends around: replay adopts, never re-litigates.
 * A live PENDING redemption means an earlier attempt may already have put
 * the allowance on the folios, so eligibility is never re-run against it;
 * the row's own amount is the money truth. Every refusal below is a FIRST
 * claim refusal and takes the honest path: snapshot cleared, totals
 * re-render, guest re-reads before paying.
 */

export type ClaimContext = {
  sessionUserId: string | null;
  /** The session's applied-offer snapshot, if any. */
  snapshot: { earnedByRecordId: string; discount: number } | null;
  /** A live PENDING redemption for this session from an earlier attempt. */
  pending: {
    id: string;
    claimantUserId: string;
    earnedByRecordId: string;
    amount: number;
  } | null;
  /** Fresh facts for the snapshot's earning stay; null when it is gone. */
  stay: StayFacts | null;
  /** The capped discount recomputed for the CURRENT basket. */
  recomputedDiscount: number;
  todayIso: string;
};

export type ClaimDecision =
  | { action: "none" }
  | { action: "adopt"; redemptionId: string; amount: number }
  | { action: "claim"; earnedByRecordId: string; amount: number }
  | {
      action: "refuse";
      reason:
        | "foreign_claim"
        | "signed_out"
        | "stay_not_eligible"
        | "window_closed"
        | "not_member"
        | "discount_changed";
    };

export function decideClaim(ctx: ClaimContext): ClaimDecision {
  if (ctx.pending) {
    // Money truth regardless of what the snapshot or the stay says now.
    // Only the claimant's identity is checked: another account must never
    // finish a booking carrying someone else's discount.
    if (ctx.sessionUserId == null || ctx.pending.claimantUserId !== ctx.sessionUserId) {
      return { action: "refuse", reason: "foreign_claim" };
    }
    return { action: "adopt", redemptionId: ctx.pending.id, amount: ctx.pending.amount };
  }

  if (!ctx.snapshot) return { action: "none" };
  if (ctx.sessionUserId == null) return { action: "refuse", reason: "signed_out" };
  if (!ctx.stay || ctx.stay.status !== "paid") {
    return { action: "refuse", reason: "stay_not_eligible" };
  }
  if (!isOfferWindowOpen({ departure: ctx.stay.departure, todayIso: ctx.todayIso })) {
    return { action: "refuse", reason: "window_closed" };
  }
  if (!isVerifiedMember(ctx.sessionUserId, ctx.stay)) {
    return { action: "refuse", reason: "not_member" };
  }
  // Any mismatch with the number the guest accepted refuses, growth
  // included (spec, decisions made for you): the amount charged against
  // must be the amount shown.
  if (Math.abs(ctx.recomputedDiscount - ctx.snapshot.discount) > 0.01) {
    return { action: "refuse", reason: "discount_changed" };
  }
  return {
    action: "claim",
    earnedByRecordId: ctx.snapshot.earnedByRecordId,
    amount: ctx.recomputedDiscount,
  };
}

// Dead checkouts leave PENDING rows. They are swept only strictly past
// Apaleo's 24h idempotency boundary: inside it a replay may still need to
// adopt the row, and sweeping it would force the re-litigation the adopt
// rule forbids.
const SWEEP_AGE_MS = 24 * 60 * 60 * 1000;

export function isSweepablePending(
  row: { status: string; createdAtIso: string },
  nowIso: string,
): boolean {
  return (
    row.status === "PENDING" && Date.parse(nowIso) - Date.parse(row.createdAtIso) > SWEEP_AGE_MS
  );
}
