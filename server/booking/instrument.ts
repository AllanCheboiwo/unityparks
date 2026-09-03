import "server-only";
import { splitAcrossLodges } from "@/lib/referral";
import { parseExtras, type SessionWithLodges } from "./session";

/**
 * The discount-instrument seam (docs/promo-codes-plan.md, section 6): one
 * planner answering which folio gets which allowance under which
 * idempotency key, for whichever instrument is riding this booking.
 *
 * Determinism IS the crash-replay guarantee: bases are session snapshots,
 * never live folio balances, so a replayed checkout produces byte-identical
 * posts and Apaleo's 24h dedup window absorbs them. Key prefixes are
 * per-instrument so two instruments in one dedup window can never swallow
 * each other's posts. The referral prefixes predate this module and must
 * not change: in-flight bookings ride their keys.
 */

export type InstrumentKind = "referral" | "credit" | "repeat";

const KEY_PREFIX: Record<InstrumentKind, string> = {
  referral: "up-allow", // shipped with the referral engine; frozen
  credit: "up-credit", // shipped with the referral engine; frozen
  repeat: "up-repeat",
};

const REASON_PREFIX: Record<InstrumentKind, string> = {
  referral: "UP-REFERRAL",
  credit: "UP-CREDIT",
  repeat: "UP-REPEAT",
};

/**
 * Deterministic per-lodge bases for splitting an instrument: the same
 * session snapshots every totals surface sums, minus any fee the
 * unit-assignment fallback just dropped. Live folio balances are
 * deliberately NOT the basis: a crash between two allowance posts would
 * change them on replay.
 */
export function snapshotBases(
  session: SessionWithLodges,
  feeDroppedBySlot: boolean[],
): number[] {
  return session.lodges.map((lodge, slot) => {
    const extras = parseExtras(lodge).reduce((sum, e) => sum + e.grossAmount, 0);
    const fee = feeDroppedBySlot[slot] ? 0 : (lodge.locationFee ?? 0);
    return Math.round((lodge.stayGrossAmount ?? 0) + extras + fee);
  });
}

export type PlannedAllowance = {
  folioId: string;
  currency: string;
  amount: number;
  idempotencyKey: string;
  reason: string;
};

export function planInstrumentAllowances(input: {
  instrument: InstrumentKind;
  sessionId: string;
  amount: number;
  bases: number[];
  folios: Array<{ folioId: string; currency: string }>;
  reasonRef: string;
}): PlannedAllowance[] {
  const shares = splitAcrossLodges(input.amount, input.bases);
  const posts: PlannedAllowance[] = [];
  for (const [slot, folio] of input.folios.entries()) {
    if (shares[slot] > 0) {
      posts.push({
        folioId: folio.folioId,
        currency: folio.currency,
        amount: shares[slot],
        idempotencyKey: `${KEY_PREFIX[input.instrument]}-${input.sessionId}-${slot}`,
        reason: `${REASON_PREFIX[input.instrument]}-${input.reasonRef}`,
      });
    }
  }
  return posts;
}
