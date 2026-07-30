/**
 * The payment plan and cancellation policy, as pure functions. Client-safe
 * (no server imports, no Prisma) so the React components and the server
 * routes read the SAME numbers - the policy can never drift between what a
 * page promises and what the money code does.
 *
 * One anchor drives everything: the balance due date, 56 days (8 weeks)
 * before arrival. Booking 57+ days out offers a 30% deposit; the balance is
 * due at day 56; cancellation refunds step down from that same day. Spec:
 * docs/deposit-and-cancellation-plan.md.
 */

export const DEPOSIT_PERCENT = 30;
export const BALANCE_DUE_DAYS = 56;
export const MIN_PART_PAYMENT = 500; // KES

// Cancellation tiers, in whole days from cancel date to arrival. Above
// BALANCE_DUE_DAYS the guest has only ever risked the deposit; from the due
// date down, penalties step up. Deposits are never refunded at any tier.
const HALF_REFUND_DAYS = 42; // 6 weeks
const QUARTER_REFUND_DAYS = 21; // 3 weeks

/** 30% of the total, whole KES. */
export function depositAmountFor(total: number): number {
  return Math.round((total * DEPOSIT_PERCENT) / 100);
}

/** Arrival minus 56 days, as an ISO date. */
export function balanceDueDateFor(arrivalIso: string): string {
  const d = new Date(`${arrivalIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - BALANCE_DUE_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one ISO date to another (negative when to < from). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * The deposit option exists only while the balance due date is still in the
 * future: 57+ days out. At 56 days or closer the balance would be due on
 * (or before) the day of booking, so full payment is the only option.
 */
export function isDepositEligible(daysToArrival: number): boolean {
  return daysToArrival > BALANCE_DUE_DAYS;
}

/**
 * Refund percentage applied to the amount paid BEYOND the deposit.
 * 100 at 57+ days, 50 at 42 to 56, 25 at 21 to 41, 0 under 21. Callers
 * decide separately that day 0 and beyond is not cancellable online.
 */
export function refundPercentFor(daysToArrival: number): number {
  if (daysToArrival > BALANCE_DUE_DAYS) return 100;
  if (daysToArrival >= HALF_REFUND_DAYS) return 50;
  if (daysToArrival >= QUARTER_REFUND_DAYS) return 25;
  return 0;
}

export type RefundComputation = {
  refundPercent: number;
  /** The non-refundable deposit actually withheld (never more than paid). */
  depositKept: number;
  refundAmount: number;
  /** Everything the guest paid that is not coming back. */
  keptAmount: number;
};

/**
 * The whole refund computation, DB-free so it is testable and the quote,
 * the execute path and the emails all share one set of numbers.
 *
 * depositAmount is null on records born before the deposit feature; the
 * fallback derives the same 30% those records would have carried. paidAmount
 * follows the same convention as the callers: legacy fully-paid records
 * (stored paidAmount 0) must be passed as paid-in-full by the caller.
 */
export function computeRefund(input: {
  total: number;
  paidAmount: number;
  depositAmount: number | null;
  daysToArrival: number;
}): RefundComputation {
  const deposit = input.depositAmount ?? depositAmountFor(input.total);
  const refundPercent = refundPercentFor(input.daysToArrival);
  const refundBase = Math.max(0, input.paidAmount - deposit);
  const refundAmount = Math.round((refundBase * refundPercent) / 100);
  return {
    refundPercent,
    depositKept: Math.min(deposit, input.paidAmount),
    refundAmount,
    keptAmount: input.paidAmount - refundAmount,
  };
}

/**
 * A part payment must either clear the balance exactly, or be at least the
 * minimum AND leave at least the minimum outstanding - otherwise a guest
 * could strand a remainder too small to ever pay off. Amounts are whole KES.
 */
export function isValidPartPayment(amount: number, outstanding: number): boolean {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  if (outstanding <= 0) return false;
  if (Math.abs(amount - outstanding) < 0.01) return true;
  return amount >= MIN_PART_PAYMENT && outstanding - amount >= MIN_PART_PAYMENT;
}
