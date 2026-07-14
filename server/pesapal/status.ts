/**
 * Pesapal status-code mapping - pure, no I/O, unit tested.
 *
 * Pesapal API 3.0 has exactly four transaction states and no PENDING:
 *   0 INVALID, 1 COMPLETED, 2 FAILED, 3 REVERSED.
 * An order that nobody has paid yet reports 0 INVALID (usually alongside an
 * error body saying "Pending Payment"), so 0 means "nothing has happened
 * yet", not "broken". We fold it into "pending": never settle on it, always
 * allow the guest to try again.
 */

export type PesapalOutcome = "pending" | "completed" | "failed" | "reversed";

export function outcomeFromStatusCode(statusCode: number | undefined): PesapalOutcome {
  switch (statusCode) {
    case 1:
      return "completed";
    case 2:
      return "failed";
    case 3:
      return "reversed";
    default:
      // 0, undefined, or anything Pesapal invents later: treat as "no
      // confirmed payment", which is the safe reading for money.
      return "pending";
  }
}

/**
 * True when what Pesapal says it collected matches what we asked for.
 * Float-tolerant to a cent; currency must match exactly.
 */
export function paymentMatchesOrder(
  order: { amount: number; currency: string },
  reported: { amount: number; currency: string | null },
): boolean {
  return (
    reported.currency === order.currency &&
    Math.abs(reported.amount - order.amount) < 0.01
  );
}
