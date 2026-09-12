import { describe, expect, it, vi } from "vitest";
import {
  EXTRAS_MIN_AGE_MS,
  SWEEP_MAX_AGE_MS,
  SWEEP_MIN_AGE_MS,
  runPaymentSweep,
  type SweepDeps,
  type SweepExtrasOrder,
  type SweepTransaction,
} from "./sweep";

/**
 * Frozen suite for UNP-46 (docs/scheduling-plan.md), the payment sweep.
 * The fakes are dumb: they hand back whatever rows the test lists and
 * record what the sweep asked them to do. Every decision (which rows are
 * old enough, which get confirmed, which get retired and alerted, what a
 * thrown error stops) belongs to the module under test.
 */

const NOW = new Date("2026-09-12T09:00:00.000Z");
const MINUTE = 60_000;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

/** Comfortably inside the window: older than the lower bound, younger than the upper. */
const IN_WINDOW = SWEEP_MIN_AGE_MS + 5 * MINUTE;

function txn(over: Partial<SweepTransaction> & { id: string }): SweepTransaction {
  return {
    recordId: `rec-${over.id}`,
    status: "pending",
    orderTrackingId: `track-${over.id}`,
    createdAt: ago(IN_WINDOW),
    ...over,
  };
}

function order(over: Partial<SweepExtrasOrder> & { id: string }): SweepExtrasOrder {
  return {
    recordId: `rec-${over.id}`,
    createdAt: ago(EXTRAS_MIN_AGE_MS + 5 * MINUTE),
    ...over,
  };
}

function fakes(input: {
  transactions?: SweepTransaction[];
  orders?: SweepExtrasOrder[];
  confirm?: SweepDeps["confirm"];
  retireUnlinked?: SweepDeps["retireUnlinked"];
  recoverExtras?: SweepDeps["recoverExtras"];
}) {
  const deps = {
    listLiveTransactions: vi.fn(async () => input.transactions ?? []),
    confirm: vi.fn(input.confirm ?? (async () => ({ outcome: "completed" as const }))),
    retireUnlinked: vi.fn(input.retireUnlinked ?? (async () => true)),
    alert: vi.fn(async (_input: Parameters<SweepDeps["alert"]>[0]) => {}),
    listLiveExtrasOrders: vi.fn(async () => input.orders ?? []),
    recoverExtras: vi.fn(input.recoverExtras ?? (async () => {})),
    logError: vi.fn(),
    now: () => NOW,
  } satisfies SweepDeps;
  return deps;
}

describe("runPaymentSweep: pending orders", () => {
  it("asks Pesapal about a live pending row once it is old enough, and a paid answer counts as settled", async () => {
    const deps = fakes({ transactions: [txn({ id: "a" })] });
    const summary = await runPaymentSweep(deps);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.confirm).toHaveBeenCalledWith("track-a");
    expect(summary).toMatchObject({ checked: 1, settled: 1, errored: 0 });
  });

  it("resumes a completed live row whose settle crashed, through the same confirm path", async () => {
    const deps = fakes({ transactions: [txn({ id: "a", status: "completed" })] });
    await runPaymentSweep(deps);
    expect(deps.confirm).toHaveBeenCalledWith("track-a");
    expect(deps.retireUnlinked).not.toHaveBeenCalled();
  });

  it("leaves a row younger than the lower bound alone: the guest may still be paying", async () => {
    const deps = fakes({
      transactions: [txn({ id: "young", createdAt: ago(SWEEP_MIN_AGE_MS - MINUTE) })],
    });
    const summary = await runPaymentSweep(deps);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.retireUnlinked).not.toHaveBeenCalled();
    expect(summary.checked).toBe(0);
  });

  it("leaves a row older than the upper bound alone: an abandoned order is not polled forever", async () => {
    const deps = fakes({
      transactions: [txn({ id: "old", createdAt: ago(SWEEP_MAX_AGE_MS + MINUTE) })],
    });
    const summary = await runPaymentSweep(deps);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(summary.checked).toBe(0);
  });

  it("counts a failed answer as retired and a pending answer as still pending", async () => {
    const answers: Record<string, "failed" | "pending"> = { "track-f": "failed", "track-p": "pending" };
    const deps = fakes({
      transactions: [txn({ id: "f" }), txn({ id: "p" })],
      confirm: async (id) => ({ outcome: answers[id] }),
    });
    const summary = await runPaymentSweep(deps);
    expect(summary).toMatchObject({ checked: 2, settled: 0, retired: 1, stillPending: 1 });
  });

  it("keeps going when one row's confirm throws, reports the error with the record id, and counts it", async () => {
    const deps = fakes({
      transactions: [txn({ id: "a" }), txn({ id: "boom" }), txn({ id: "c" })],
      confirm: async (id) => {
        if (id === "track-boom") throw new Error("Pesapal 502");
        return { outcome: "completed" };
      },
    });
    const summary = await runPaymentSweep(deps);
    expect(deps.confirm).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ checked: 3, settled: 2, errored: 1 });
    expect(deps.logError).toHaveBeenCalledTimes(1);
    const context = deps.logError.mock.calls[0][2] as Record<string, unknown>;
    expect(context.recordId).toBe("rec-boom");
  });

  it("does nothing and reports zeros when nothing is live", async () => {
    const deps = fakes({});
    const summary = await runPaymentSweep(deps);
    expect(summary).toEqual({
      checked: 0,
      settled: 0,
      retired: 0,
      stillPending: 0,
      unlinked: 0,
      extrasRecovered: 0,
      errored: 0,
    });
  });
});

describe("runPaymentSweep: rows that never got a tracking id", () => {
  it("retires the row and raises one payment_unlinked alert naming the merchant reference", async () => {
    const deps = fakes({ transactions: [txn({ id: "lost", orderTrackingId: null })] });
    const summary = await runPaymentSweep(deps);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.retireUnlinked).toHaveBeenCalledWith("lost");
    expect(deps.alert).toHaveBeenCalledTimes(1);
    const alert = deps.alert.mock.calls[0][0];
    expect(alert.kind).toBe("payment_unlinked");
    expect(alert.recordId).toBe("rec-lost");
    expect(alert.detail.merchantReference).toBe("lost");
    expect(summary).toMatchObject({ unlinked: 1, errored: 0 });
  });

  it("raises no alert when the retire loses to a stamp that just landed", async () => {
    const deps = fakes({
      transactions: [txn({ id: "racing", orderTrackingId: null })],
      retireUnlinked: async () => false,
    });
    const summary = await runPaymentSweep(deps);
    expect(deps.alert).not.toHaveBeenCalled();
    expect(summary.unlinked).toBe(0);
  });

  it("never retires a completed row: collected money is not a lost reference", async () => {
    const deps = fakes({
      transactions: [txn({ id: "sim", status: "completed", orderTrackingId: null })],
    });
    await runPaymentSweep(deps);
    expect(deps.retireUnlinked).not.toHaveBeenCalled();
    expect(deps.alert).not.toHaveBeenCalled();
  });

  it("leaves a young unlinked row alone: the stamp may be seconds away", async () => {
    const deps = fakes({
      transactions: [
        txn({ id: "fresh", orderTrackingId: null, createdAt: ago(SWEEP_MIN_AGE_MS - MINUTE) }),
      ],
    });
    await runPaymentSweep(deps);
    expect(deps.retireUnlinked).not.toHaveBeenCalled();
    expect(deps.alert).not.toHaveBeenCalled();
  });
});

describe("runPaymentSweep: stale extras orders", () => {
  it("runs recovery for a live order past the grace, not for one inside it", async () => {
    const deps = fakes({
      orders: [order({ id: "stale" }), order({ id: "fresh", createdAt: ago(EXTRAS_MIN_AGE_MS - MINUTE) })],
    });
    const summary = await runPaymentSweep(deps);
    expect(deps.recoverExtras).toHaveBeenCalledTimes(1);
    expect(deps.recoverExtras).toHaveBeenCalledWith("rec-stale");
    expect(summary.extrasRecovered).toBe(1);
  });

  it("a failing recovery is reported and counted, and the next order is still tried", async () => {
    const deps = fakes({
      orders: [order({ id: "bad" }), order({ id: "good" })],
      recoverExtras: async (recordId) => {
        if (recordId === "rec-bad") throw new Error("folio read failed");
      },
    });
    const summary = await runPaymentSweep(deps);
    expect(deps.recoverExtras).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ extrasRecovered: 1, errored: 1 });
    expect(deps.logError).toHaveBeenCalledTimes(1);
  });

  it("a payment error does not skip the extras pass", async () => {
    const deps = fakes({
      transactions: [txn({ id: "boom" })],
      orders: [order({ id: "stale" })],
      confirm: async () => {
        throw new Error("Pesapal down");
      },
    });
    const summary = await runPaymentSweep(deps);
    expect(deps.recoverExtras).toHaveBeenCalledWith("rec-stale");
    expect(summary).toMatchObject({ errored: 1, extrasRecovered: 1 });
  });
});
