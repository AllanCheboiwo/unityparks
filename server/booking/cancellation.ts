import "server-only";
import type { BookingRecord, BookingReservation, BookingSession } from "@prisma/client";
import { prisma } from "../db";
import { cancelReservationOnce } from "../apaleo/cancel";
import { getFolioForReservation } from "../apaleo/bookings";
import { refundFolio } from "../apaleo/payments";
import { PublicError } from "../api-helpers";
import { sendBookingCancellation } from "../email/bookingCancellation";

/**
 * Self-serve cancellation. Apaleo supplies the two primitives (cancel the
 * reservation, refund the folio); the tier policy deciding HOW MUCH comes
 * back is ours, the same split as everywhere else in this app: Apaleo owns
 * inventory and money movements, we own the commercial rules.
 *
 * The tiers, counted in whole days from today (UTC) to arrival:
 *   28 or more days out   full refund
 *   8 to 27 days out      half refund
 *   7 days or fewer       no refund (cancelling still frees the lodge)
 *   arrival day onwards   not cancellable online, call the team
 */

const FULL_REFUND_DAYS = 28;
const HALF_REFUND_DAYS = 8;

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
  total: number;
  currency: string;
};

function daysUntil(arrivalIso: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return Math.round(
    (Date.parse(`${arrivalIso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

function refundPercentFor(daysToArrival: number): number {
  if (daysToArrival >= FULL_REFUND_DAYS) return 100;
  if (daysToArrival >= HALF_REFUND_DAYS) return 50;
  return 0;
}

export function quoteCancellation(record: RecordForCancel): CancellationQuote {
  const daysToArrival = daysUntil(record.session.arrival);
  const base = {
    daysToArrival,
    total: record.totalGrossAmount,
    currency: record.currency,
  };

  if (record.status === "cancelled") {
    return {
      ...base,
      cancellable: false,
      reason: "This break is already cancelled.",
      refundPercent: 0,
      refundAmount: record.refundAmount ?? 0,
      keptAmount: record.totalGrossAmount - (record.refundAmount ?? 0),
    };
  }
  if (record.status !== "paid") {
    return {
      ...base,
      cancellable: false,
      reason: "Only paid bookings can be cancelled here. Call our team on +254 700 000 000.",
      refundPercent: 0,
      refundAmount: 0,
      keptAmount: 0,
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
    };
  }

  const refundPercent = refundPercentFor(daysToArrival);
  const refundAmount = Math.round((record.totalGrossAmount * refundPercent) / 100);
  return {
    ...base,
    cancellable: true,
    reason: null,
    refundPercent,
    refundAmount,
    keptAmount: record.totalGrossAmount - refundAmount,
  };
}

/**
 * Cancel every lodge and refund what the tier allows. Shaped like the
 * settle loop it mirrors: each Apaleo step is individually idempotent
 * (status check before cancel, idempotency key on each refund), so a crash
 * anywhere lets the whole function simply run again. The DB flip at the
 * end is the once-only gate: exactly one caller wins the paid-to-cancelled
 * transition, and only the winner sends the email.
 */
export async function cancelBooking(record: RecordForCancel): Promise<CancellationQuote> {
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
    ? record.reservations
    : [
        {
          slot: 0,
          apaleoReservationId: record.apaleoReservationId,
          folioId: record.folioId,
          grossAmount: record.totalGrossAmount,
        },
      ];

  for (const child of children) {
    await cancelReservationOnce(child.apaleoReservationId);

    const share = Math.round((child.grossAmount * quote.refundPercent) / 100);
    if (share > 0) {
      const folioId =
        child.folioId ?? (await getFolioForReservation(child.apaleoReservationId)).folioId;
      await refundFolio({
        folioId,
        amount: share,
        currency: record.currency,
        receipt: `CANCEL-${record.apaleoBookingId}`,
        idempotencyKey: `up-refund-${record.id}-${child.slot}`,
      });
    }
  }

  // Per-lodge rounding decides what actually moved; record that sum, not
  // the record-level estimate, so the stored number matches the folios.
  const refunded = children.reduce(
    (sum, child) => sum + Math.round((child.grossAmount * quote.refundPercent) / 100),
    0,
  );

  const flipped = await prisma.bookingRecord.updateMany({
    where: { id: record.id, status: "paid" },
    data: { status: "cancelled", cancelledAt: new Date(), refundAmount: refunded },
  });
  if (flipped.count === 1) {
    await sendBookingCancellation(record.id);
  }

  return { ...quote, refundAmount: refunded, keptAmount: record.totalGrossAmount - refunded };
}
