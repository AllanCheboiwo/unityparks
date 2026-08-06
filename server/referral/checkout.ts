import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { PublicError } from "../api-helpers";
import { postAllowance } from "../apaleo/payments";
import { parseExtras, setReferralOnSession, type SessionWithLodges } from "../booking/session";
import { validateReferralCode, refusalMessage } from "./validate";
import { vestedCreditBalance } from "./derive";
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
 * and any applied credit as folio allowances, claims the credit spend in
 * the ledger, and hands back the attribution row for the record's nested
 * create. Everything downstream (deposit, Pesapal, settle, refunds) then
 * absorbs the discount with no further code (plan 5.2).
 *
 * Replay safety: the split bases are session snapshots (identical on every
 * retry), so the allowance bodies are deterministic and Apaleo's 24h
 * idempotency window dedupes the racing-tabs and crash-retry cases, the
 * same boundary the booking create itself lives with. The credit spend row
 * is keyed by session (unique), claimed in a Serializable transaction
 * BEFORE the folio is touched, so two tabs cannot double-spend a pool and
 * a crash-replay finds and reuses its own claim. The CLAIM is authoritative
 * for money, never the session's applyCredit flag: a claim left behind by
 * a failed attempt is adopted here even if the guest has since toggled the
 * flag, and the credit route can only detach one by releasing it back to
 * the pool (both halves of the orphaned-spend fix from the diff review).
 */

export type ReferralAtCheckout = {
  /** Nested-create payload for BookingRecord, or null (no code applied). */
  attribution: Prisma.ReferralAttributionUncheckedCreateWithoutRecordInput | null;
  /** Whether any allowance was posted (folios must be re-read for totals). */
  postedAllowances: boolean;
};

const NOTHING: ReferralAtCheckout = { attribution: null, postedAllowances: false };

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

  // A crashed earlier attempt may have committed this session's spend
  // claim. It is the money truth regardless of what the session flags say
  // now, unless the guest released it back to the pool via the credit
  // route.
  const existingSpend = await prisma.referralLedgerEntry.findUnique({
    where: { spentOnSessionId: session.id },
  });
  const releasedSpend = existingSpend
    ? await prisma.referralLedgerEntry.findUnique({
        where: { releaseOfEntryId: existingSpend.id },
        select: { id: true },
      })
    : null;
  const claimedSpend = existingSpend && !releasedSpend ? existingSpend : null;

  if (!session.referralCode && !session.applyCredit && !claimedSpend) {
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
    // same floor the part-payment rules enforce).
    discount = Math.min(check.discount, Math.max(0, totalBase - MIN_PART_PAYMENT));
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

    const rate = check.participant.commissionRate ?? check.config.defaultCommissionRate;
    const base = commissionBaseFor(lodgingGross, discount);
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
  if (claimedSpend) {
    // Adopt the committed claim from the crashed attempt: post its
    // allowance this time and keep the display flags honest with it. The
    // owning participant may even be revoked by now; the money was already
    // committed, so it is honoured, not dropped.
    const participant = await prisma.referralParticipant.findUnique({
      where: { id: claimedSpend.participantId },
      select: { code: true },
    });
    credit = Math.round(Math.abs(claimedSpend.amount));
    creditReason = `UP-CREDIT-${participant?.code ?? "CREDIT"}`;
    await prisma.bookingSession.updateMany({
      where: { id: session.id, booking: null },
      data: { applyCredit: true, creditAmount: credit },
    });
  } else if (session.applyCredit) {
    if (!session.userId) {
      // The identity that applied the credit is gone (shared-machine
      // sign-out). Refuse, never silently skip a number every screen
      // subtracted.
      await prisma.bookingSession.updateMany({
        where: { id: session.id, booking: null },
        data: { applyCredit: false, creditAmount: null },
      });
      throw new PublicError(
        409,
        "Please sign in to use your referral credit. It has been removed - review your total and press Buy now again.",
      );
    }
    const participant = await prisma.referralParticipant.findUnique({
      where: { userId: session.userId },
    });
    if (!participant || participant.revokedAt) {
      await prisma.bookingSession.updateMany({
        where: { id: session.id, booking: null },
        data: { applyCredit: false, creditAmount: null },
      });
      throw new PublicError(
        409,
        "Your referral credit is not available. It has been removed - please review your total and press Buy now again.",
      );
    }
    creditReason = `UP-CREDIT-${participant.code}`;
    const stamped = session.creditAmount;
    let outcome: { kind: "ok" | "none" | "short"; amount: number };
    try {
      outcome = await prisma.$transaction(
        async (tx) => {
          const vested = await vestedCreditBalance(participant.id, tx);
          const applicable = capApplicableCredit({
            bookingTotal: totalBase,
            discount,
            vestedBalance: vested,
          });
          if (applicable <= 0) return { kind: "none" as const, amount: 0 };
          // The guest accepted a specific number on the pay page. Coming up
          // short (a supporting earn amended away, another device spending
          // the pool) must refuse, not quietly post less than promised.
          if (stamped != null && applicable + 0.01 < stamped) {
            return { kind: "short" as const, amount: applicable };
          }
          await tx.referralLedgerEntry.create({
            data: {
              participantId: participant.id,
              kind: "credit_spend",
              amount: -applicable,
              spentOnSessionId: session.id,
            },
          });
          return { kind: "ok" as const, amount: applicable };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // The racing tab claimed it first; adopt that claim.
        const claimed = await prisma.referralLedgerEntry.findUnique({
          where: { spentOnSessionId: session.id },
        });
        outcome = claimed
          ? { kind: "ok", amount: Math.round(-claimed.amount) }
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
    if (outcome.kind !== "ok") {
      await prisma.bookingSession.updateMany({
        where: { id: session.id, booking: null },
        data: { applyCredit: false, creditAmount: null },
      });
      throw new PublicError(
        409,
        "Your referral credit balance has changed and could not be applied. It has been removed - please review your total and press Buy now again.",
      );
    }
    credit = outcome.amount;
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
