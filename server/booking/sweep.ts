/**
 * The payment sweep (UNP-40, UNP-46): find money Pesapal collected that
 * nobody told us about, and extras orders whose settle never ran.
 *
 * The sweep decides nothing about money itself. Every pending or completed
 * row it finds is handed to the same confirm path the IPN and callback use,
 * so a payment is recorded one way whoever noticed it. The one state change
 * the sweep makes on its own authority is retiring a pending row that never
 * got a Pesapal reference (the process died between Pesapal's reply and our
 * stamp): nothing on our side can find that order, so it is retired and a
 * human is told the merchant reference to look up on Pesapal's side.
 *
 * Dependencies are injected so the decisions here are testable without a
 * database; sweepWire.ts binds them to Prisma, checkout and extras.
 */

/** Younger than this and the guest may still be on Pesapal's page. */
export const SWEEP_MIN_AGE_MS = 15 * 60_000;
/** Older than this and the order is abandoned; stop polling it. */
export const SWEEP_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** Comfortably past the extras engine's own in-flight grace (5 minutes),
 *  so recovery never meets an order genuinely mid-flight. */
export const EXTRAS_MIN_AGE_MS = 10 * 60_000;

export const UNLINKED_ALERT_KIND = "payment_unlinked";

export type SweepTransaction = {
  id: string;
  recordId: string;
  /** pending or completed: the only live statuses. */
  status: string;
  orderTrackingId: string | null;
  createdAt: Date;
};

export type SweepExtrasOrder = {
  id: string;
  recordId: string;
  createdAt: Date;
};

export type SweepDeps = {
  /** Every PesapalTransaction still holding liveForRecordId. Age is the sweep's call. */
  listLiveTransactions(): Promise<SweepTransaction[]>;
  /** confirmPesapalPayment: idempotent, settles or retires as Pesapal says. */
  confirm(orderTrackingId: string): Promise<{ outcome: "completed" | "pending" | "failed" }>;
  /** Guarded retire of a pending row with no tracking id. False when the guard missed. */
  retireUnlinked(transactionId: string): Promise<boolean>;
  alert(input: {
    kind: string;
    recordId: string;
    summary: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
  /** Every ExtrasOrder still holding liveForRecordId. */
  listLiveExtrasOrders(): Promise<SweepExtrasOrder[]>;
  /** recoverStaleExtrasOrder for that record. */
  recoverExtras(recordId: string): Promise<void>;
  logError(message: string, error: unknown, context: Record<string, unknown>): void;
  now?: () => Date;
};

export type SweepSummary = {
  /** Live payment rows old enough to look at. */
  checked: number;
  settled: number;
  retired: number;
  stillPending: number;
  unlinked: number;
  extrasRecovered: number;
  /** Rows (payment or extras) whose handling threw; each is logged. */
  errored: number;
};

export async function runPaymentSweep(deps: SweepDeps): Promise<SweepSummary> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const summary: SweepSummary = {
    checked: 0,
    settled: 0,
    retired: 0,
    stillPending: 0,
    unlinked: 0,
    extrasRecovered: 0,
    errored: 0,
  };

  for (const txn of await deps.listLiveTransactions()) {
    const age = now - txn.createdAt.getTime();
    if (age < SWEEP_MIN_AGE_MS || age > SWEEP_MAX_AGE_MS) continue;
    summary.checked += 1;
    try {
      if (txn.orderTrackingId) {
        const { outcome } = await deps.confirm(txn.orderTrackingId);
        if (outcome === "completed") summary.settled += 1;
        else if (outcome === "failed") summary.retired += 1;
        else summary.stillPending += 1;
        continue;
      }
      // No reference and money collected (simulated provider, or a settle
      // that crashed): not the sweep's to retire. The guest's next Buy now
      // resumes it through runPaymentAttempt's collected path.
      if (txn.status !== "pending") continue;

      if (await deps.retireUnlinked(txn.id)) {
        summary.unlinked += 1;
        await deps.alert({
          kind: UNLINKED_ALERT_KIND,
          recordId: txn.recordId,
          summary: `Payment attempt ${txn.id} lost its Pesapal reference; check Pesapal for merchant reference ${txn.id}`,
          detail: {
            transactionId: txn.id,
            merchantReference: txn.id,
            recordId: txn.recordId,
            createdAt: txn.createdAt.toISOString(),
          },
        });
      }
    } catch (err) {
      summary.errored += 1;
      deps.logError("Payment sweep: row failed", err, {
        route: "ops/payments/sweep",
        recordId: txn.recordId,
        transactionId: txn.id,
      });
    }
  }

  for (const order of await deps.listLiveExtrasOrders()) {
    if (now - order.createdAt.getTime() < EXTRAS_MIN_AGE_MS) continue;
    try {
      await deps.recoverExtras(order.recordId);
      summary.extrasRecovered += 1;
    } catch (err) {
      summary.errored += 1;
      deps.logError("Payment sweep: extras recovery failed", err, {
        route: "ops/payments/sweep",
        recordId: order.recordId,
        orderId: order.id,
      });
    }
  }

  return summary;
}
