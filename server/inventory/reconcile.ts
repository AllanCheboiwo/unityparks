import "server-only";

/**
 * Reconciliation (UNP-6, docs/activity-inventory-plan.md section 5.12) as
 * a pure function over a snapshot. Three invariants, reported never fixed:
 *
 *  1. every ResourceDay.taken equals the sum of its unexpired HELD plus
 *     CONFIRMED holds;
 *  2. every CONFIRMED order-hold belongs to a settled order on a record
 *     that is not cancelled;
 *  3. for every lodge with settled orders on a capacity-limited service,
 *     Apaleo's count for that service equals the ledger's (bikes: riders on
 *     any one night; spa: total places).
 *
 * The route and the script gather the snapshot and turn violations into
 * OpsAlert rows. Adjustments count toward invariant 1 and never toward 3.
 */

export type DriftInput = {
  now: Date;
  resources: Array<{ id: string; code: string; apaleoServiceCode: string; kind: string }>;
  days: Array<{ resourceId: string; date: string; taken: number }>;
  holds: Array<{
    resourceId: string;
    date: string;
    qty: number;
    status: string;
    kind: string;
    ownerKey: string | null;
    orderId: string | null;
    recordId: string | null;
    slot: number | null;
    expiresAt: Date | null;
  }>;
  orders: Array<{ id: string; recordId: string; slot: number; status: string }>;
  records: Array<{ id: string; status: string }>;
  apaleoCounts: Array<{ recordId: string; slot: number; serviceCode: string; count: number }>;
  /** "recordId|slot" keys whose Apaleo read failed this run: no verdict
   *  on invariant 3 for them, rather than a false "Apaleo has 0". */
  unreadable?: ReadonlySet<string>;
};

export type Drift =
  | { kind: "counter"; resourceId: string; date: string; taken: number; ledger: number }
  | {
      kind: "orphan_confirmed";
      ownerKey: string | null;
      orderId: string | null;
      recordId: string | null;
      resourceId: string;
      date: string;
      why: "record_cancelled" | "order_not_settled" | "order_missing";
    }
  | {
      kind: "apaleo_mismatch";
      recordId: string;
      slot: number;
      serviceCode: string;
      apaleo: number;
      ledger: number;
    };

function counts(hold: DriftInput["holds"][number], now: Date): boolean {
  if (hold.status === "CONFIRMED") return true;
  if (hold.status === "HELD") return hold.expiresAt !== null && hold.expiresAt > now;
  return false;
}

export function findDrift(input: DriftInput): Drift[] {
  const drift: Drift[] = [];

  // 1. Counter versus ledger, over every day that has a row or a hold.
  const ledger = new Map<string, number>();
  for (const hold of input.holds) {
    if (!counts(hold, input.now)) continue;
    const key = `${hold.resourceId}|${hold.date}`;
    ledger.set(key, (ledger.get(key) ?? 0) + hold.qty);
  }
  const seenDays = new Set<string>();
  for (const day of input.days) {
    const key = `${day.resourceId}|${day.date}`;
    seenDays.add(key);
    const sum = ledger.get(key) ?? 0;
    if (day.taken !== sum) {
      drift.push({ kind: "counter", resourceId: day.resourceId, date: day.date, taken: day.taken, ledger: sum });
    }
  }
  for (const [key, sum] of ledger) {
    if (seenDays.has(key)) continue;
    const [resourceId, date] = key.split("|");
    drift.push({ kind: "counter", resourceId, date, taken: 0, ledger: sum });
  }

  // 2. Orphaned confirmations.
  const orderById = new Map(input.orders.map((o) => [o.id, o]));
  const recordById = new Map(input.records.map((r) => [r.id, r]));
  for (const hold of input.holds) {
    if (hold.kind !== "ORDER" || hold.status !== "CONFIRMED") continue;
    const order = hold.orderId ? orderById.get(hold.orderId) : undefined;
    const record = hold.recordId ? recordById.get(hold.recordId) : undefined;
    const why = !order
      ? "order_missing"
      : order.status !== "settled"
        ? "order_not_settled"
        : record?.status === "cancelled"
          ? "record_cancelled"
          : null;
    if (why) {
      drift.push({
        kind: "orphan_confirmed",
        ownerKey: hold.ownerKey,
        orderId: hold.orderId,
        recordId: hold.recordId,
        resourceId: hold.resourceId,
        date: hold.date,
        why,
      });
    }
  }

  // 3. Apaleo versus ledger per (record, slot, service). Only services a
  //    resource backs; a retired code on an old booking is not ours to check.
  const resourceById = new Map(input.resources.map((r) => [r.id, r]));
  const backedCodes = new Set(input.resources.map((r) => r.apaleoServiceCode));
  // Ledger per lodge and service: stock is riders on any one night (the
  // max over nights), sessions are total places.
  const stockByNight = new Map<string, Map<string, number>>();
  const sessionTotal = new Map<string, number>();
  const lodgeKeys = new Set<string>();
  for (const hold of input.holds) {
    if (hold.kind !== "ORDER" || hold.status !== "CONFIRMED") continue;
    if (hold.recordId === null || hold.slot === null) continue;
    const resource = resourceById.get(hold.resourceId);
    if (!resource) continue;
    const key = `${hold.recordId}|${hold.slot}|${resource.apaleoServiceCode}`;
    lodgeKeys.add(key);
    if (resource.kind === "SESSION") {
      sessionTotal.set(key, (sessionTotal.get(key) ?? 0) + hold.qty);
    } else {
      const nights = stockByNight.get(key) ?? new Map<string, number>();
      nights.set(hold.date, (nights.get(hold.date) ?? 0) + hold.qty);
      stockByNight.set(key, nights);
    }
  }
  const ledgerFor = (key: string): number => {
    const nights = stockByNight.get(key);
    const stock = nights ? Math.max(0, ...nights.values()) : 0;
    return stock + (sessionTotal.get(key) ?? 0);
  };
  const apaleoByKey = new Map<string, number>();
  for (const line of input.apaleoCounts) {
    if (!backedCodes.has(line.serviceCode)) continue;
    const key = `${line.recordId}|${line.slot}|${line.serviceCode}`;
    apaleoByKey.set(key, line.count);
    lodgeKeys.add(key);
  }
  for (const key of lodgeKeys) {
    const [recordId, slotText, serviceCode] = key.split("|");
    if (input.unreadable?.has(`${recordId}|${slotText}`)) continue;
    const apaleo = apaleoByKey.get(key) ?? 0;
    const ours = ledgerFor(key);
    if (apaleo !== ours) {
      drift.push({ kind: "apaleo_mismatch", recordId, slot: Number(slotText), serviceCode, apaleo, ledger: ours });
    }
  }

  return drift;
}
