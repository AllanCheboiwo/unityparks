import "server-only";
import type { BookingRecord, BookingReservation, BookingSession } from "@prisma/client";
import { prisma } from "../db";
import { cancelReservationOnce } from "../apaleo/cancel";
import { getFolioForReservation } from "../apaleo/bookings";
import { refundFolio } from "../apaleo/payments";
import { PublicError } from "../api-helpers";
import { sendBookingCancellation } from "../email/bookingCancellation";
import { computeRefund, daysBetween } from "@/lib/paymentPlan";

/**
 * Self-serve cancellation. Apaleo supplies the two primitives (cancel the
 * reservation, refund the folio); the policy deciding HOW MUCH comes back
 * is ours, and lives in lib/paymentPlan so the pages promise exactly what
 * this file pays: Apaleo owns inventory and money movements, we own the
 * commercial rules.
 *
 * The deposit (30% of the total) is never refunded, at any tier - including
 * bookings paid in full, whose total simply contains it. The tier
 * percentage applies to whatever was paid BEYOND the deposit, counted in
 * whole days from today (UTC) to arrival:
 *   57 or more days out   100% of the balance paid back (deposit kept)
 *   42 to 56 days out     50% of the balance paid
 *   21 to 41 days out     25% of the balance paid
 *   20 days or fewer      no refund (cancelling still frees the lodge)
 *   arrival day onwards   not cancellable online, call the team
 */

type RecordForCancel = BookingRecord & {
  reservations: BookingReservation[];
  session: BookingSession;
};

export type CancellationQuote = {
  cancellable: boolean;
  /** Guest-facing explanation when cancellable is false. */
  reason: string | null;
  daysToArrival: number;
  refundPercent: number;
  refundAmount: number;
  keptAmount: number;
  /** What the guest has actually paid so far; refunds come out of this. */
  paidAmount: number;
  /** The non-refundable deposit inside keptAmount. */
  depositKept: number;
  total: number;
  currency: string;
};

/**
 * What the guest has really paid. Records from before the deposit feature
 * store paidAmount 0 while being fully paid, so status is the tiebreak:
 * paid (and cancelled, which only paid records could reach back then) means
 * the full total went through.
 */
function effectivePaid(record: BookingRecord): number {
  if (record.paidAmount > 0) return record.paidAmount;
  return record.status === "paid" || record.status === "cancelled"
    ? record.totalGrossAmount
    : 0;
}

export function quoteCancellation(record: RecordForCancel): CancellationQuote {
  const daysToArrival = daysBetween(
    new Date().toISOString().slice(0, 10),
    record.session.arrival,
  );
  const paidSoFar = effectivePaid(record);
  const base = {
    daysToArrival,
    paidAmount: paidSoFar,
    total: record.totalGrossAmount,
    currency: record.currency,
  };

  if (record.status === "cancelled") {
    const refunded = record.refundAmount ?? 0;
    return {
      ...base,
      cancellable: false,
      reason: "This break is already cancelled.",
      refundPercent: 0,
      refundAmount: refunded,
      keptAmount: paidSoFar - refunded,
      // Deliberately ?? 0, not the derived-30% fallback used on live quotes:
      // a booking cancelled before the deposit feature was cancelled under
      // terms that had no deposit, and its history should say so.
      depositKept: Math.min(record.depositAmount ?? 0, paidSoFar),
    };
  }
  if (record.status !== "paid" && record.status !== "deposit_paid") {
    return {
      ...base,
      cancellable: false,
      reason:
        "Only paid or deposit-paid bookings can be cancelled here. Call our team on +254 700 000 000.",
      refundPercent: 0,
      refundAmount: 0,
      keptAmount: 0,
      depositKept: 0,
    };
  }
  if (daysToArrival <= 0) {
    return {
      ...base,
      cancellable: false,
      reason:
        "Your break starts today or has already begun, so it can't be cancelled online. Call our team on +254 700 000 000.",
      refundPercent: 0,
      refundAmount: 0,
      keptAmount: 0,
      depositKept: 0,
    };
  }

  const refund = computeRefund({
    total: record.totalGrossAmount,
    paidAmount: paidSoFar,
    depositAmount: record.depositAmount,
    daysToArrival,
  });
  return {
    ...base,
    cancellable: true,
    reason: null,
    refundPercent: refund.refundPercent,
    refundAmount: refund.refundAmount,
    keptAmount: refund.keptAmount,
    depositKept: refund.depositKept,
  };
}

/**
 * Cancel every lodge and refund what the policy allows, pro rata on what
 * each folio actually received - a folio can never be asked to give back
 * more than went into it. Shaped like the settle loop it mirrors: each
 * Apaleo step is individually idempotent (status check before cancel,
 * idempotency key on each refund), so a crash anywhere lets the whole
 * function simply run again. The DB flip at the end is the once-only gate:
 * exactly one caller wins the transition to cancelled, and only the winner
 * sends the email.
 */
export async function cancelBooking(staleRecord: RecordForCancel): Promise<CancellationQuote> {
  // The quote and the refund shares must come from a FRESH read, never the
  // route's snapshot: a balance payment can settle between the route loading
  // its record and this call, and a stale paidAmount would refund the guest
  // against the wrong basis. (The mirror-image guard lives in settlePayment,
  // whose status write refuses a record that went cancelled mid-settle.)
  const record =
    ((await prisma.bookingRecord.findUnique({
      where: { id: staleRecord.id },
      include: {
        reservations: { orderBy: { slot: "asc" } },
        session: true,
      },
    })) as RecordForCancel | null) ?? staleRecord;

  const quote = quoteCancellation(record);
  if (!quote.cancellable) {
    // Re-entry after an earlier success reads as "already cancelled":
    // return that outcome instead of erroring the retry.
    if (record.status === "cancelled") return quote;
    throw new PublicError(409, quote.reason ?? "This booking can't be cancelled.");
  }

  // Legacy single-lodge records carry no child rows; fall back to the
  // record-level reservation so the loop shape stays the same.
  const children = record.reservations.length
    ? record.reservations.map((c) => ({
        slot: c.slot,
        apaleoReservationId: c.apaleoReservationId,
        folioId: c.folioId,
        paid: c.paidAmount > 0 ? c.paidAmount : record.status === "paid" ? c.grossAmount : 0,
      }))
    : [
        {
          slot: 0,
          apaleoReservationId: record.apaleoReservationId,
          folioId: record.folioId,
          paid: quote.paidAmount,
        },
      ];

  // Deterministic refund shares, the same remainder discipline as the
  // settle split: every paid-into folio but the last takes its rounded
  // pro-rata slice of the refund, the last takes the exact remainder.
  const paidTotal = children.reduce((sum, c) => sum + c.paid, 0);
  const refundable = children.map((_, i) => i).filter((i) => children[i].paid > 0.01);
  const shares = new Array<number>(children.length).fill(0);
  let allocated = 0;
  for (const [pos, i] of refundable.entries()) {
    shares[i] =
      pos === refundable.length - 1
        ? Math.round(quote.refundAmount - allocated)
        : Math.round((quote.refundAmount * children[i].paid) / paidTotal);
    allocated += shares[i];
  }

  for (const [i, child] of children.entries()) {
    await cancelReservationOnce(child.apaleoReservationId);

    if (shares[i] > 0) {
      const folioId =
        child.folioId ?? (await getFolioForReservation(child.apaleoReservationId)).folioId;
      await refundFolio({
        folioId,
        amount: shares[i],
        currency: record.currency,
        receipt: `CANCEL-${record.apaleoBookingId}`,
        idempotencyKey: `up-refund-${record.id}-${child.slot}`,
      });
    }
  }

  const refunded = shares.reduce((sum, s) => sum + s, 0);

  const flipped = await prisma.bookingRecord.updateMany({
    where: { id: record.id, status: { in: ["paid", "deposit_paid"] } },
    data: { status: "cancelled", cancelledAt: new Date(), refundAmount: refunded },
  });
  if (flipped.count === 1) {
    // Narrow race, loud detection: a settle that committed while the Apaleo
    // cancel-and-refund loop ran raised paidAmount past the refund basis.
    // The guest is owed more back than was posted; a human reconciles from
    // this log. (Settles that arrive AFTER the flip are turned away by
    // settlePayment's own cancelled guard and marked excess there.)
    //
    // This is diagnostics, never control flow: a throw here would 500 a
    // cancellation that already succeeded, and the retry would take the
    // already-cancelled early return and never send the email. Swallow it.
    try {
      const after = await prisma.bookingRecord.findUnique({
        where: { id: record.id },
        select: { paidAmount: true },
      });
      if (after && Math.abs(after.paidAmount - record.paidAmount) > 0.01) {
        console.error(
          "Balance payment landed MID-CANCEL; refund basis was stale",
          JSON.stringify({
            recordId: record.id,
            basisPaid: record.paidAmount,
            nowPaid: after.paidAmount,
            refunded,
          }),
        );
      }
    } catch (err) {
      console.error("Mid-cancel drift check failed (non-fatal)", err);
    }
    // Referral void: the referrer's reward dies with the booking. Best
    // effort inside the gate; a crash before this write self-heals at read,
    // because every money predicate joins record.status and treats a
    // cancelled record as void regardless (the attribution state is a
    // once-only guard and an ops label, not the truth). Spent referral
    // credit needs no write at all: the spendable derivation stops counting
    // spends on cancelled bookings, which IS the restoration.
    try {
      await prisma.referralAttribution.updateMany({
        where: { recordId: record.id, state: { not: "void" } },
        data: { state: "void", voidedAt: new Date() },
      });
    } catch (err) {
      console.error("Referral void failed (self-heals at read)", err);
    }
    await sendBookingCancellation(record.id);
  }

  return { ...quote, refundAmount: refunded, keptAmount: quote.paidAmount - refunded };
}
