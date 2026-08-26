import "server-only";
import { Prisma, type ReferralLedgerEntry } from "@prisma/client";
import { prisma } from "../db";
import { PublicError } from "../api-helpers";
import { postAllowance } from "../apaleo/payments";
import { parseExtras, setReferralOnSession, type SessionWithLodges } from "../booking/session";
import { validateReferralCode, refusalMessage } from "./validate";
import { vestedCreditBalance } from "./derive";
import { findClaim, isLiveClaim, markClaimPosting, releaseClaim } from "./claim";
import { VELOCITY_ALERT_THRESHOLD, VELOCITY_WINDOW_DAYS } from "./ops";
import { sendEmail } from "../email/resend";
import {
  capApplicableCredit,
  commissionAmountFor,
  commissionBaseFor,
  splitAcrossLodges,
} from "@/lib/referral";
import { MIN_PART_PAYMENT } from "@/lib/paymentPlan";

/**
 * The referral moment inside ensureRecord: strictly after unit assignment
 * (whose 422 fallback can drop a location fee) and strictly before the
 * folio-balance reads that freeze the booking's totals. Posts the discount
 * and any applied credit as folio allowances, commits the credit claim in
 * the ledger, and hands back the attribution row for the record's nested
 * create. Everything downstream (deposit, Pesapal, settle, refunds) then
 * absorbs the discount with no further code (plan 5.2).
 *
 * Replay safety: the split bases are session snapshots (identical on every
 * retry), so the allowance bodies are deterministic and Apaleo's 24h
 * idempotency window dedupes the racing-tabs and crash-retry cases, the
 * same boundary the booking create itself lives with.
 *
 * Credit safety: the ledger CLAIM is authoritative, never the session's
 * applyCredit flag, and the claim's own row carries its state (see
 * ./claim.ts). Checkout marks a claim as committed-to-a-folio immediately
 * before posting its allowance; a guest releasing credit at that moment
 * loses the race on that row and one of the two backs off. Without this,
 * a release could restore the pool while the allowance still landed on the
 * bill: the same credit counted twice.
 */

export type ReferralAtCheckout = {
  /** Nested-create payload for BookingRecord, or null (no code applied). */
  attribution: Prisma.ReferralAttributionUncheckedCreateWithoutRecordInput | null;
  /** Whether any allowance was posted (folios must be re-read for totals). */
  postedAllowances: boolean;
};

const NOTHING: ReferralAtCheckout = { attribution: null, postedAllowances: false };

/** Display flags off, ledger untouched. Used by every refusal path. */
async function clearCreditFlags(sessionId: string): Promise<void> {
  await prisma.bookingSession.updateMany({
    where: { id: sessionId, booking: null },
    data: { applyCredit: false, creditAmount: null },
  });
}

/**
 * Make a frozen booking's display flags agree with the ledger. Called when
 * ensureRecord takes its existing-record path: a credit toggled on while
 * that record was mid-flight would otherwise leave the funnel rendering a
 * credit the frozen total never absorbed (and the reverse after a refused
 * attempt). The record exists here, so this writes past the freeze guard
 * deliberately, exactly like the dropped-location-fee cleanup.
 */
export async function reconcileCreditFlags(sessionId: string): Promise<void> {
  const claim = await findClaim(sessionId);
  const live = isLiveClaim(claim) ? claim : null;
  await prisma.bookingSession.update({
    where: { id: sessionId },
    data: live
      ? { applyCredit: true, creditAmount: Math.round(Math.abs(live.amount)) }
      : { applyCredit: false, creditAmount: null },
  });
}

export async function applyReferralAtCheckout(input: {
  session: SessionWithLodges;
  /** Per-slot outcome of assignUnits; a dropped fee shrinks that base. */
  feeDroppedBySlot: boolean[];
  folios: Array<{ folioId: string; currency: string }>;
}): Promise<ReferralAtCheckout> {
  const { session, folios } = input;

  // A racing tab's record can commit during this attempt's long Apaleo
  // flight (createBooking + assignUnits), after which the freeze guards on
  // the routes are blind to us. Adopt-don't-post: the winner froze its
  // totals without our allowances, and posting one now would wedge its
  // settlement. This check narrows that window to the instant before our
  // first side effect; the residual millisecond race is documented in the
  // plan's known edges.
  const raced = await prisma.bookingRecord.findUnique({
    where: { sessionId: session.id },
    select: { id: true },
  });
  if (raced) return NOTHING;

  // A crashed earlier attempt may have committed this session's claim. It
  // is the money truth regardless of what the session flags say now,
  // unless the guest gave it back to the pool.
  const existingClaim = await findClaim(session.id);
  const liveClaim = isLiveClaim(existingClaim) ? existingClaim : null;

  if (!session.referralCode && !session.applyCredit && !liveClaim) {
    return NOTHING;
  }

  // Deterministic per-lodge bases: the same snapshots every totals surface
  // sums, minus any fee the unit-assignment fallback just dropped. Live
  // folio balances are deliberately NOT the basis: a crash between two
  // allowance posts would change them on replay (settle's own warning).
  const bases = session.lodges.map((lodge, slot) => {
    const extras = parseExtras(lodge).reduce((sum, e) => sum + e.grossAmount, 0);
    const fee = input.feeDroppedBySlot[slot] ? 0 : (lodge.locationFee ?? 0);
    return Math.round((lodge.stayGrossAmount ?? 0) + extras + fee);
  });
  const totalBase = bases.reduce((sum, b) => sum + b, 0);
  const lodgingGross = session.lodges.reduce(
    (sum, lodge) => sum + (lodge.stayGrossAmount ?? 0),
    0,
  );

  // --- The referral code, re-validated authoritatively ---------------------
  let attribution: Prisma.ReferralAttributionUncheckedCreateWithoutRecordInput | null = null;
  let discount = 0;
  let discountReason = "";
  if (session.referralCode) {
    const check = await validateReferralCode({
      code: session.referralCode,
      guestEmail: session.guestEmail,
      guestPhone: session.guestPhone,
      sessionUserId: session.userId,
    });
    if (!check.ok) {
      // Same discipline as the dropped location fee: clear the session so
      // every totals surface re-renders honestly, then refuse this attempt.
      // The next Buy now proceeds undiscounted; silently charging more than
      // every screen showed is not an option.
      await setReferralOnSession(session.id, { code: null, discount: null });
      throw new PublicError(
        409,
        `${refusalMessage(check.reason)} The discount has been removed - please review your total and press Buy now again.`,
      );
    }
    // Cap so the booking keeps a collectable remainder (whole-KES minimum,
    // same floor the part-payment rules enforce). A cap that bites means
    // the screens promised more than this booking can absorb, so it is
    // restamped and refused rather than applied quietly.
    discount = Math.min(check.discount, Math.max(0, totalBase - MIN_PART_PAYMENT));
    if (session.referralDiscount != null && discount + 0.01 < session.referralDiscount) {
      await setReferralOnSession(session.id, { code: session.referralCode, discount });
      throw new PublicError(
        409,
        "Your referral discount is larger than this booking can take, so it has been reduced. Please review your total and press Buy now again.",
      );
    }
    discountReason = `UP-REFERRAL-${check.participant.code}`;

    // Velocity check: a hot code is reviewed by a human, never auto-frozen
    // (self-referral economics are already unattractive, plan section 9).
    // Loud log always; email only when an ops address is configured.
    const since = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recent = await prisma.referralAttribution.count({
      where: { participantId: check.participant.id, createdAt: { gte: since } },
    });
    if (recent + 1 >= VELOCITY_ALERT_THRESHOLD) {
      console.error(
        `[referral] velocity: code ${check.participant.code} at ${recent + 1} attributions in ${VELOCITY_WINDOW_DAYS} days`,
      );
      const opsEmail = process.env.OPS_ALERT_EMAIL;
      if (opsEmail) {
        // Fire-and-forget; an alert must never block a checkout.
        sendEmail({
          to: opsEmail,
          subject: `Referral velocity: ${check.participant.code} at ${recent + 1} in ${VELOCITY_WINDOW_DAYS} days`,
          text: `Code ${check.participant.code} (${check.participant.name}) reached ${recent + 1} attributions in the last ${VELOCITY_WINDOW_DAYS} days. Review at /ops/referrals.`,
          html: `<p>Code <strong>${check.participant.code}</strong> (${check.participant.name}) reached ${recent + 1} attributions in the last ${VELOCITY_WINDOW_DAYS} days. Review at /ops/referrals.</p>`,
        }).catch((err) => console.error("[referral] velocity alert email failed", err));
      }
    }

    // One internal rate for everyone (decided 25 Aug 2026): the config row
    // in force, never a per-participant number. The commissionRate column
    // stays as the seam for negotiated rates later; nothing reads it today.
    const rate = check.config.defaultCommissionRate;
    const base = commissionBaseFor(lodgingGross, discount, check.config.vatRate);
    attribution = {
      participantId: check.participant.id,
      configId: check.config.id,
      discountAmount: discount,
      rewardAmount:
        check.participant.kind === "influencer"
          ? commissionAmountFor(base, rate)
          : Math.round(check.config.clientCredit),
      commissionBase: check.participant.kind === "influencer" ? base : null,
      gift: check.gift,
      // allowanceRefs filled in below once the posts have ids.
    };
  }

  // --- Applied credit ------------------------------------------------------
  let credit = 0;
  let creditReason = "";
  let creditClaim: ReferralLedgerEntry | null = null;

  if (liveClaim) {
    // A claim from a crashed attempt. Honour it only for the account that
    // made it: a shared machine can sign a different guest into this walk,
    // and spending the first guest's credit on the second guest's booking
    // is the exact failure the identity-change clearing exists to prevent.
    const participant = await prisma.referralParticipant.findUnique({
      where: { id: liveClaim.participantId },
      select: { code: true, userId: true },
    });
    const ownsThisWalk =
      participant?.userId != null && session.userId != null && participant.userId === session.userId;
    if (!ownsThisWalk) {
      // Give it straight back to its owner and carry on without credit.
      // The identity change already cleared the display flags, so nothing
      // on screen promised this booking a discount.
      const released = await releaseClaim(liveClaim);
      await clearCreditFlags(session.id);
      if (!released) {
        // Committed: its allowance is already on these folios, so simply
        // continuing would hand the other account's credit to whoever is
        // signed in now. Refuse the walk instead.
        console.error(
          `[referral] claim ${liveClaim.id} on session ${session.id} is committed to another account's credit; refusing checkout`,
        );
        throw new PublicError(
          409,
          "This booking already has referral credit applied by another account. Please start a new search.",
        );
      }
      console.error(
        `[referral] claim ${liveClaim.id} on session ${session.id} belonged to another account and was released to its owner`,
      );
    } else {
      creditClaim = liveClaim;
      credit = Math.round(Math.abs(liveClaim.amount));
      creditReason = `UP-CREDIT-${participant.code}`;
      await prisma.bookingSession.updateMany({
        where: { id: session.id, booking: null },
        data: { applyCredit: true, creditAmount: credit },
      });
    }
  } else if (session.applyCredit) {
    if (!session.userId) {
      // The identity that applied the credit is gone (shared-machine
      // sign-out). Refuse, never silently skip a number every screen
      // subtracted.
      await clearCreditFlags(session.id);
      throw new PublicError(
        409,
        "Please sign in to use your referral credit. It has been removed - review your total and press Buy now again.",
      );
    }
    const participant = await prisma.referralParticipant.findUnique({
      where: { userId: session.userId },
    });
    if (!participant || participant.revokedAt) {
      await clearCreditFlags(session.id);
      throw new PublicError(
        409,
        "Your referral credit is not available. It has been removed - please review your total and press Buy now again.",
      );
    }
    creditReason = `UP-CREDIT-${participant.code}`;
    const stamped = session.creditAmount;
    let outcome: { kind: "ok" | "none" | "short"; amount: number; claimId?: string };
    try {
      outcome = await prisma.$transaction(
        async (tx) => {
          const vested = await vestedCreditBalance(participant.id, tx);
          let applicable = capApplicableCredit({
            bookingTotal: totalBase,
            discount,
            vestedBalance: vested,
          });
          if (applicable <= 0) return { kind: "none" as const, amount: 0 };
          // The guest accepted a specific number on the pay page. Coming up
          // short must refuse rather than quietly post less than promised;
          // coming up LONG (the pool grew meanwhile) is clamped, because
          // spending more of their credit than they agreed to is equally
          // not ours to decide.
          if (stamped != null && applicable + 0.01 < stamped) {
            return { kind: "short" as const, amount: applicable };
          }
          if (stamped != null && applicable > stamped) applicable = stamped;
          const created = await tx.referralLedgerEntry.create({
            data: {
              participantId: participant.id,
              kind: "credit_spend",
              amount: -applicable,
              spentOnSessionId: session.id,
            },
          });
          return { kind: "ok" as const, amount: applicable, claimId: created.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Someone claimed this session's slot first: a racing tab, or an
        // earlier attempt whose claim the guest has since released (the
        // slot stays occupied forever either way). Adopt only a live claim
        // that belongs to this participant, same rule as the top-level
        // adoption path.
        const claimed = await findClaim(session.id);
        outcome =
          isLiveClaim(claimed) && claimed.participantId === participant.id
            ? { kind: "ok", amount: Math.round(Math.abs(claimed.amount)), claimId: claimed.id }
            : { kind: "none", amount: 0 };
      } else if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2034"
      ) {
        throw new PublicError(409, "Please press Buy now again to apply your credit.");
      } else {
        throw err;
      }
    }
    if (outcome.kind !== "ok" || !outcome.claimId) {
      await clearCreditFlags(session.id);
      throw new PublicError(
        409,
        "Your referral credit balance has changed and could not be applied. It has been removed - please review your total and press Buy now again.",
      );
    }
    credit = outcome.amount;
    creditClaim = await prisma.referralLedgerEntry.findUniqueOrThrow({
      where: { id: outcome.claimId },
    });
    // Keep the display snapshot honest with what was actually claimed.
    await prisma.bookingSession.updateMany({
      where: { id: session.id, booking: null },
      data: { creditAmount: credit },
    });
  }

  if (discount <= 0 && credit <= 0) {
    return { attribution, postedAllowances: false };
  }

  // The basket can shrink between a committed claim and this retry (lodge
  // or extras changes are allowed while no record exists). A committed
  // spend is never clamped down silently; the guest resolves it by
  // removing the code at the details step or unticking the credit (which
  // releases the claim), then pressing Buy now again.
  if (discount + credit > totalBase - MIN_PART_PAYMENT) {
    throw new PublicError(
      409,
      "Your referral discount and credit together no longer fit this booking's total. Remove the code on the details step or untick the credit, then press Buy now again.",
    );
  }

  // Point of no return for the credit: commit the claim to this booking
  // before any of it reaches a folio. Losing this guarded write means the
  // guest released the credit first and the pool already has it back, so
  // posting the allowance now would hand out the same credit twice.
  if (credit > 0 && creditClaim) {
    const committed = await markClaimPosting(creditClaim.id);
    if (!committed) {
      await clearCreditFlags(session.id);
      throw new PublicError(
        409,
        "Your referral credit was removed from this booking. Please review your total and press Buy now again.",
      );
    }
  }

  // --- Post the allowances, deterministic split, own key per family --------
  const discountShares = discount > 0 ? splitAcrossLodges(discount, bases) : bases.map(() => 0);
  // Credit splits over what the discount left, so no folio can be pushed
  // into credit even when both ride one booking.
  const remaining = bases.map((base, slot) => base - discountShares[slot]);
  const creditShares = credit > 0 ? splitAcrossLodges(credit, remaining) : bases.map(() => 0);

  const allowanceRefs: string[] = [];
  for (const [slot, folio] of folios.entries()) {
    if (discountShares[slot] > 0) {
      const posted = await postAllowance({
        folioId: folio.folioId,
        amount: discountShares[slot],
        currency: folio.currency,
        reason: discountReason,
        idempotencyKey: `up-allow-${session.id}-${slot}`,
      });
      allowanceRefs.push(posted.allowanceId);
    }
    if (creditShares[slot] > 0) {
      const posted = await postAllowance({
        folioId: folio.folioId,
        amount: creditShares[slot],
        currency: folio.currency,
        reason: creditReason,
        idempotencyKey: `up-credit-${session.id}-${slot}`,
      });
      allowanceRefs.push(posted.allowanceId);
    }
  }

  if (attribution) attribution.allowanceRefs = JSON.stringify(allowanceRefs);
  return { attribution, postedAllowances: true };
}
