import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { PublicError } from "../api-helpers";
import { postAllowance } from "../apaleo/payments";
import { parseExtras, setReferralOnSession, type SessionWithLodges } from "../booking/session";
import { validateReferralCode, refusalMessage } from "./validate";
import { vestedCreditBalance } from "./derive";
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
 * a crash-replay finds and reuses its own claim.
 */

export type ReferralAtCheckout = {
  /** Nested-create payload for BookingRecord, or null (no code applied). */
  attribution: Prisma.ReferralAttributionUncheckedCreateWithoutRecordInput | null;
  /** Whether any allowance was posted (folios must be re-read for totals). */
  postedAllowances: boolean;
};

export async function applyReferralAtCheckout(input: {
  session: SessionWithLodges;
  /** Per-slot outcome of assignUnits; a dropped fee shrinks that base. */
  feeDroppedBySlot: boolean[];
  folios: Array<{ folioId: string; currency: string }>;
}): Promise<ReferralAtCheckout> {
  const { session, folios } = input;
  if (!session.referralCode && !session.applyCredit) {
    return { attribution: null, postedAllowances: false };
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

  // --- Applied credit: claim the spend BEFORE touching the folio -----------
  let credit = 0;
  let creditReason = "";
  if (session.applyCredit && session.userId) {
    const participant = await prisma.referralParticipant.findUnique({
      where: { userId: session.userId },
    });
    if (!participant || participant.revokedAt) {
      await prisma.bookingSession.update({
        where: { id: session.id },
        data: { applyCredit: false, creditAmount: null },
      });
      throw new PublicError(
        409,
        "Your referral credit is not available. It has been removed - please review your total and press Buy now again.",
      );
    }
    creditReason = `UP-CREDIT-${participant.code}`;
    try {
      credit = await prisma.$transaction(
        async (tx) => {
          // Crash-replay: this session already claimed its spend; reuse it.
          const existing = await tx.referralLedgerEntry.findUnique({
            where: { spentOnSessionId: session.id },
          });
          if (existing) return Math.round(-existing.amount);

          const vested = await vestedCreditBalance(participant.id, tx);
          const applicable = capApplicableCredit({
            bookingTotal: totalBase,
            discount,
            vestedBalance: vested,
          });
          if (applicable <= 0) return 0;
          await tx.referralLedgerEntry.create({
            data: {
              participantId: participant.id,
              kind: "credit_spend",
              amount: -applicable,
              spentOnSessionId: session.id,
            },
          });
          return applicable;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // The racing tab claimed it first; adopt that claim.
        const claimed = await prisma.referralLedgerEntry.findUnique({
          where: { spentOnSessionId: session.id },
        });
        credit = claimed ? Math.round(-claimed.amount) : 0;
      } else if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2034"
      ) {
        throw new PublicError(409, "Please press Buy now again to apply your credit.");
      } else {
        throw err;
      }
    }
    if (credit <= 0) {
      await prisma.bookingSession.update({
        where: { id: session.id },
        data: { applyCredit: false, creditAmount: null },
      });
      throw new PublicError(
        409,
        "Your referral credit balance has changed and could not be applied. It has been removed - please review your total and press Buy now again.",
      );
    }
    // Keep the display snapshot honest with what was actually claimed.
    await prisma.bookingSession.update({
      where: { id: session.id },
      data: { creditAmount: credit },
    });
  }

  if (discount <= 0 && credit <= 0) {
    return { attribution, postedAllowances: false };
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
