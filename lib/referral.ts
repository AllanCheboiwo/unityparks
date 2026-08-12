/**
 * Referral policy as pure functions. Client-safe (no server imports, no
 * Prisma) so the funnel components and the money code read the SAME numbers,
 * exactly like lib/paymentPlan.ts. Spec: docs/referral-system-plan.md.
 *
 * Everything here is arithmetic and classification over plain data. The
 * server modules under server/referral/ own the queries and hand rows to
 * these functions, which keeps the money math testable without a database.
 */

import { MIN_PART_PAYMENT } from "./paymentPlan";

/** Generated codes use this alphabet: no 0/O or 1/I lookalikes. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const GENERATED_CODE_LENGTH = 6;

/** Uppercase, trimmed; the one normalizer for anything code-shaped. */
export function normalizeReferralCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Format gate for typed codes, deliberately wider than the generated
 * alphabet: vanity codes (AMINA) may use any A-Z letter. Length 3 to 12,
 * letters and digits only.
 */
export function isValidCodeFormat(code: string): boolean {
  return /^[A-Z0-9]{3,12}$/.test(code);
}

/**
 * Deterministic pro-rata split of a whole-KES amount across per-lodge bases,
 * matching the settle split discipline: rounded shares, last takes the exact
 * remainder, and no share may exceed its base (a folio pushed into credit
 * reads as money owed, checkout.ts:661). The bases are the session's
 * per-lodge snapshots, which exist before the record does and are identical
 * on every retry, so the split is stable under crash-replay.
 *
 * Overflow from a clamped share carries to the next lodge with room. Callers
 * must cap `total` at or below the sum of bases; this throws rather than
 * silently posting a different discount than promised.
 */
export function splitAcrossLodges(total: number, bases: number[]): number[] {
  if (!bases.length) throw new Error("splitAcrossLodges: no bases");
  const sumBases = bases.reduce((s, b) => s + b, 0);
  if (total > sumBases) throw new Error("splitAcrossLodges: total exceeds bases");
  if (total <= 0) return bases.map(() => 0);

  const shares = bases.map((base, i) =>
    i === bases.length - 1 ? 0 : Math.round((total * base) / sumBases),
  );
  shares[bases.length - 1] = total - shares.reduce((s, x) => s + x, 0);

  // Clamp pass: no share above its base, no negative share (a rounding
  // overshoot can drive the remainder negative); excess carries forward,
  // then a final backward pass mops up anything still stranded.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < shares.length; i += 1) {
      const clamped = Math.min(Math.max(shares[i], 0), bases[i]);
      let excess = shares[i] - clamped;
      shares[i] = clamped;
      for (let j = 0; excess !== 0 && j < shares.length; j += 1) {
        if (j === i) continue;
        const room = excess > 0 ? bases[j] - shares[j] : -shares[j];
        const move = excess > 0 ? Math.min(excess, room) : Math.max(excess, room);
        shares[j] += move;
        excess -= move;
      }
      if (excess !== 0) throw new Error("splitAcrossLodges: could not place remainder");
    }
  }
  return shares;
}

/**
 * How much credit may be applied to a booking: the vested balance, capped so
 * at least MIN_PART_PAYMENT of the booking stays collectable after the
 * referral discount too. Whole KES, floored at zero.
 */
export function capApplicableCredit(input: {
  bookingTotal: number;
  discount: number;
  vestedBalance: number;
}): number {
  const room = Math.floor(input.bookingTotal - input.discount - MIN_PART_PAYMENT);
  return Math.max(0, Math.min(Math.floor(input.vestedBalance), room));
}

export type ReferralConfigRow = {
  id: string;
  effectiveFrom: string; // ISO date
  guestDiscount: number;
  clientCredit: number;
  defaultCommissionRate: number;
  creditExpiryDays: number;
};

/**
 * The config in force on a given UTC date: the latest row whose
 * effectiveFrom is on or before it. Null when no row applies (program not
 * yet configured); callers treat that as "no referral program".
 */
export function configInForce<T extends ReferralConfigRow>(configs: T[], isoDate: string): T | null {
  let best: T | null = null;
  for (const config of configs) {
    if (config.effectiveFrom > isoDate) continue;
    if (!best || config.effectiveFrom > best.effectiveFrom) best = config;
  }
  return best;
}

/**
 * Commission base for an influencer attribution: the lodging-only session
 * snapshots minus the referral discount (the program does not pay commission
 * on revenue it gave away), floored at zero. Gross, VAT-inclusive: the rate
 * is chosen with that in mind (plan section 6.4).
 */
export function commissionBaseFor(lodgingGross: number, discount: number): number {
  return Math.max(0, Math.round(lodgingGross - discount));
}

/** rate * base, whole KES. */
export function commissionAmountFor(base: number, rate: number): number {
  return Math.round(base * rate);
}

// ---------------------------------------------------------------------------
// Read-time classification. No vesting cron exists: whether value is
// spendable or payable is a predicate over data we already hold, evaluated
// wherever it is displayed or redeemed (plan section 7).
// ---------------------------------------------------------------------------

/** What the classifiers need to know about an earn row's booking. */
export type EarnContext = {
  attributionState: string; // booked | earned | void
  recordStatus: string; // created | deposit_paid | paid | failed | cancelled
  departure: string; // ISO date, read live from the booking session
  creditExpiryDays: number; // from the attribution's frozen config
  todayIso: string;
};

/**
 * A credit earn is VESTED (spendable) once the referred stay completed and
 * nothing has unwound it: record still paid, attribution not void, departure
 * passed, not expired. The attribution-state check and the record-status
 * check overlap on purpose: a crashed void write self-heals here.
 */
export function isCreditEarnVested(ctx: EarnContext): boolean {
  if (ctx.attributionState === "void") return false;
  if (ctx.recordStatus !== "paid") return false;
  if (ctx.departure >= ctx.todayIso) return false;
  return !isCreditEarnExpired(ctx);
}

export function isCreditEarnExpired(ctx: EarnContext): boolean {
  const expiry = new Date(`${ctx.departure}T00:00:00Z`);
  expiry.setUTCDate(expiry.getUTCDate() + ctx.creditExpiryDays);
  return expiry.toISOString().slice(0, 10) < ctx.todayIso;
}

/**
 * A commission earn is PAYABLE on the same predicate minus expiry:
 * commissions are contracted cash and never expire.
 */
export function isCommissionEarnPayable(ctx: Omit<EarnContext, "creditExpiryDays">): boolean {
  if (ctx.attributionState === "void") return false;
  if (ctx.recordStatus !== "paid") return false;
  return ctx.departure < ctx.todayIso;
}

/** What the spend classifier needs to know about the booking it rode. */
export type SpendContext = {
  /** Null when the checkout never produced a record. */
  recordStatus: string | null;
  /** The session's TTL stamp; a fresh session may still be mid-checkout. */
  sessionExpiresAt: Date;
  now: Date;
};

/**
 * A credit spend COUNTS against the pool while its booking is alive or
 * plausibly in flight, and stops counting (credit restored, zero writes)
 * when the booking cancelled, failed, or never happened:
 *
 * - record deposit_paid or paid: counts.
 * - record created: counts. Abandoned created records lock credit until an
 *   ops credit_release, deliberately: created is resumable indefinitely, so
 *   auto-release would double-redeem if the checkout later resumed.
 * - record cancelled or failed: does not count. This IS the refund.
 * - no record, session still fresh: counts (checkout in flight).
 * - no record, session expired: never happened, does not count.
 */
export function isSpendActive(ctx: SpendContext): boolean {
  if (ctx.recordStatus === "cancelled" || ctx.recordStatus === "failed") return false;
  if (ctx.recordStatus !== null) return true;
  return ctx.sessionExpiresAt.getTime() >= ctx.now.getTime();
}
