import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { findDrift, type DriftInput } from "./reconcile";

/**
 * Frozen suite for UNP-6 (docs/activity-inventory-plan.md, section 5.12):
 * reconciliation as a pure function over a snapshot of the ledger, the
 * counters, the orders, the records and Apaleo's counts. The route and
 * the script feed it and turn its violations into OpsAlert rows; that
 * plumbing is acceptance work.
 *
 * Reports, never fixes: the function returns violations and touches
 * nothing.
 */

const NOW = new Date("2026-11-01T12:00:00Z");
const LIVE = new Date("2099-01-01T00:00:00Z");
const DEAD = new Date("2000-01-01T00:00:00Z");

function clean(): DriftInput {
  return {
    now: NOW,
    resources: [
      { id: "res-adult", code: "CYCLE-ADULT", apaleoServiceCode: "CYCLE-ADULT", kind: "STOCK" },
      { id: "res-spa", code: "SPA-1400", apaleoServiceCode: "SPA-SESSION", kind: "SESSION" },
    ],
    days: [
      { resourceId: "res-adult", date: "2026-12-11", taken: 3 },
      { resourceId: "res-adult", date: "2026-12-12", taken: 3 },
      { resourceId: "res-spa", date: "2026-12-12", taken: 2 },
    ],
    holds: [
      // Order o-1 on record rec-1: two adult bikes, two nights, plus a spa session.
      { resourceId: "res-adult", date: "2026-12-11", qty: 2, status: "CONFIRMED", kind: "ORDER", ownerKey: "order:o-1", orderId: "o-1", recordId: "rec-1", slot: 0, expiresAt: null },
      { resourceId: "res-adult", date: "2026-12-12", qty: 2, status: "CONFIRMED", kind: "ORDER", ownerKey: "order:o-1", orderId: "o-1", recordId: "rec-1", slot: 0, expiresAt: null },
      { resourceId: "res-spa", date: "2026-12-12", qty: 2, status: "CONFIRMED", kind: "ORDER", ownerKey: "order:o-1", orderId: "o-1", recordId: "rec-1", slot: 0, expiresAt: null },
      // A workshop adjustment on the same nights.
      { resourceId: "res-adult", date: "2026-12-11", qty: 1, status: "CONFIRMED", kind: "ADJUSTMENT", ownerKey: null, orderId: null, recordId: null, slot: null, expiresAt: null },
      { resourceId: "res-adult", date: "2026-12-12", qty: 1, status: "CONFIRMED", kind: "ADJUSTMENT", ownerKey: null, orderId: null, recordId: null, slot: null, expiresAt: null },
    ],
    orders: [{ id: "o-1", recordId: "rec-1", slot: 0, status: "settled" }],
    records: [{ id: "rec-1", status: "paid" }],
    apaleoCounts: [
      { recordId: "rec-1", slot: 0, serviceCode: "CYCLE-ADULT", count: 2 },
      { recordId: "rec-1", slot: 0, serviceCode: "SPA-SESSION", count: 2 },
    ],
  };
}

describe("findDrift", () => {
  it("a consistent snapshot has no violations", () => {
    expect(findDrift(clean())).toEqual([]);
  });

  it("a counter that disagrees with its ledger is reported with both numbers", () => {
    const input = clean();
    input.days[0].taken = 5;
    const drift = findDrift(input);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      kind: "counter",
      resourceId: "res-adult",
      date: "2026-12-11",
      taken: 5,
      ledger: 3,
    });
  });

  it("an unexpired HELD hold counts toward the ledger; an expired one does not", () => {
    const input = clean();
    input.holds.push({
      resourceId: "res-adult", date: "2026-12-11", qty: 1, status: "HELD", kind: "ORDER",
      ownerKey: "order:o-2", orderId: "o-2", recordId: "rec-1", slot: 0, expiresAt: LIVE,
    });
    input.orders.push({ id: "o-2", recordId: "rec-1", slot: 0, status: "created" });
    input.days[0].taken = 4;
    expect(findDrift(input)).toEqual([]);

    input.holds[input.holds.length - 1].expiresAt = DEAD;
    expect(findDrift(input)).toMatchObject([{ kind: "counter", taken: 4, ledger: 3 }]);
  });

  it("a RELEASED hold counts nothing", () => {
    const input = clean();
    input.holds.push({
      resourceId: "res-spa", date: "2026-12-12", qty: 7, status: "RELEASED", kind: "ORDER",
      ownerKey: "order:o-9", orderId: "o-9", recordId: "rec-1", slot: 0, expiresAt: null,
    });
    input.orders.push({ id: "o-9", recordId: "rec-1", slot: 0, status: "failed" });
    expect(findDrift(input)).toEqual([]);
  });

  it("a CONFIRMED hold on a cancelled record is an orphan", () => {
    const input = clean();
    input.records[0].status = "cancelled";
    const drift = findDrift(input);
    expect(drift.filter((d) => d.kind === "orphan_confirmed")).toHaveLength(3);
    expect(drift.find((d) => d.kind === "orphan_confirmed")).toMatchObject({
      ownerKey: "order:o-1",
      recordId: "rec-1",
    });
  });

  it("a CONFIRMED hold whose order never settled is an orphan", () => {
    const input = clean();
    input.orders[0].status = "failed";
    expect(findDrift(input).filter((d) => d.kind === "orphan_confirmed")).toHaveLength(3);
  });

  it("Apaleo holding more of a service than the ledger confirms is reported, and vice versa", () => {
    const more = clean();
    more.apaleoCounts[0].count = 3;
    expect(findDrift(more)).toMatchObject([
      { kind: "apaleo_mismatch", recordId: "rec-1", slot: 0, serviceCode: "CYCLE-ADULT", apaleo: 3, ledger: 2 },
    ]);

    const less = clean();
    less.apaleoCounts[1].count = 1;
    expect(findDrift(less)).toMatchObject([
      { kind: "apaleo_mismatch", serviceCode: "SPA-SESSION", apaleo: 1, ledger: 2 },
    ]);
  });

  it("bikes compare riders per night, not riders times nights; spa compares total places", () => {
    // Two riders over two nights is four hold-quantity in the ledger and 2 on Apaleo. Consistent.
    expect(findDrift(clean())).toEqual([]);
  });

  it("a service Apaleo carries that no resource backs (a retired code on an old booking) is ignored", () => {
    const input = clean();
    input.apaleoCounts.push({ recordId: "rec-1", slot: 0, serviceCode: "CYCLE", count: 2 });
    expect(findDrift(input)).toEqual([]);
  });

  it("adjustments never appear in the Apaleo comparison", () => {
    const input = clean();
    input.holds.push({
      resourceId: "res-adult", date: "2026-12-11", qty: 4, status: "CONFIRMED", kind: "ADJUSTMENT",
      ownerKey: null, orderId: null, recordId: null, slot: null, expiresAt: null,
    });
    input.days[0].taken = 7;
    expect(findDrift(input)).toEqual([]);
  });
});
