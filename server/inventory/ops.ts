import "server-only";
import { prisma } from "../db";
import { getReservationServices } from "../apaleo/services";
import { raiseOpsAlert } from "../ops/alerts";
import { placeHolds, sweepExpired } from "./holds";
import { findDrift, type Drift } from "./reconcile";
import { PublicError } from "../api-helpers";
import { stayNights } from "@/lib/inventory";

/**
 * The ops surface for the activities inventory (UNP-6, spec 5.11 and
 * 5.12). The one rule: nobody hand-edits `taken`. Reality changes are
 * adjustment holds with a reason, or capacity edits; both keep the
 * invariants provable.
 */

export const GRID_DAYS = 30;

export type ResourceRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  capacity: number;
  sessionStart: string | null;
  sessionMinutes: number | null;
  apaleoServiceCode: string;
  openDaysBefore: number | null;
  capRule: string;
  sellAtCheckout: boolean;
  active: boolean;
};

export type GridCell = { date: string; taken: number };

export type InventoryOverview = {
  resources: ResourceRow[];
  /** From today, GRID_DAYS days, per resource: taken per date (0 when untouched). */
  dates: string[];
  grid: Record<string, GridCell[]>;
  openAlerts: number;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function inventoryOverview(): Promise<InventoryOverview> {
  const resources = await prisma.inventoryResource.findMany({
    orderBy: [{ kind: "asc" }, { code: "asc" }],
  });
  const start = todayIso();
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + GRID_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const dates = stayNights(start, end);
  const days = await prisma.resourceDay.findMany({
    where: { date: { gte: start, lt: end } },
  });
  const grid: Record<string, GridCell[]> = {};
  for (const resource of resources) {
    grid[resource.id] = dates.map((date) => ({
      date,
      taken: days.find((d) => d.resourceId === resource.id && d.date === date)?.taken ?? 0,
    }));
  }
  const openAlerts = await prisma.opsAlert.count({
    where: { resolvedAt: null, kind: { in: ["inventory_drift", "inventory_oversold"] } },
  });
  return { resources, dates, grid, openAlerts };
}

export type ResourceInput = {
  code: string;
  name: string;
  kind: "STOCK" | "SESSION";
  capacity: number;
  sessionStart: string | null;
  sessionMinutes: number | null;
  apaleoServiceCode: string;
  openDaysBefore: number | null;
  capRule: "adults" | "children";
  sellAtCheckout: boolean;
  active: boolean;
};

/** Create or update a resource by code. Capacity edits never touch holds
 *  (spec 9: a cut below taken shows sold out until holds release). */
export async function saveResource(input: ResourceInput): Promise<ResourceRow> {
  if (input.kind === "SESSION") {
    if (!input.sessionStart || !/^\d{2}:\d{2}$/.test(input.sessionStart)) {
      throw new PublicError(400, "A session needs a start time, HH:MM.");
    }
    const [h, m] = input.sessionStart.split(":").map(Number);
    const minutes = input.sessionMinutes ?? 0;
    if (h * 60 + m + minutes > 24 * 60) {
      throw new PublicError(400, "A session cannot cross midnight.");
    }
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 0) {
    throw new PublicError(400, "Capacity must be a whole number of zero or more.");
  }
  return prisma.inventoryResource.upsert({
    where: { code: input.code },
    create: input,
    update: input,
  });
}

export type AdjustmentInput = {
  resourceCode: string;
  from: string;
  to: string; // inclusive
  qty: number;
  reason: string;
  createdBy: string;
};

/** Reality as a hold: broken bikes, a walk-in hire, staff use. Goes
 *  through the same guarded update, so an adjustment past capacity is
 *  refused like any claim; shrink capacity instead if the fleet shrank. */
export async function addAdjustment(input: AdjustmentInput): Promise<{ dates: number }> {
  const resource = await prisma.inventoryResource.findUnique({ where: { code: input.resourceCode } });
  if (!resource) throw new PublicError(404, "No such resource.");
  if (!Number.isInteger(input.qty) || input.qty < 1) {
    throw new PublicError(400, "Quantity must be a whole number of at least one.");
  }
  if (!input.reason.trim()) throw new PublicError(400, "Give a reason; it is the audit trail.");
  if (input.to < input.from) throw new PublicError(400, "The end date is before the start date.");
  const endExclusive = new Date(Date.parse(`${input.to}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const dates = stayNights(input.from, endExclusive);
  if (dates.length === 0 || dates.length > 366) {
    throw new PublicError(400, "Pick a date range of one day to one year.");
  }
  const placed = await placeHolds({
    ownerKey: null,
    kind: "ADJUSTMENT",
    lines: dates.map((date) => ({ resourceId: resource.id, date, qty: input.qty })),
    expiresAt: null,
    reason: input.reason.trim(),
    createdBy: input.createdBy,
  });
  if (!placed.ok) {
    throw new PublicError(
      409,
      `Only ${placed.refusal.available} of ${resource.name} free on ${placed.refusal.date}; nothing was adjusted. Reduce capacity instead if the fleet shrank.`,
    );
  }
  return { dates: dates.length };
}

export async function runSweep(): Promise<{ released: number }> {
  return { released: await sweepExpired(new Date()) };
}

/**
 * Gather the snapshot, find drift, and file each violation as an OpsAlert
 * of kind inventory_drift, deduplicated on an open alert with the same
 * detail so the button can be pressed twice. Apaleo is read once per
 * lodge that holds confirmed order-holds; everything else is local.
 */
export async function runReconcile(): Promise<{ violations: Drift[]; filed: number }> {
  const now = new Date();
  // Past stays cannot be oversold any more and Apaleo is read-only history
  // for them; a week's margin still catches a late settle on a just-
  // departed break. Without this bound the Apaleo reads below grow with
  // every booking that ever added an activity.
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [resources, days, holds] = await Promise.all([
    prisma.inventoryResource.findMany(),
    prisma.resourceDay.findMany({ where: { date: { gte: since } } }),
    prisma.inventoryHold.findMany({ where: { date: { gte: since } } }),
  ]);
  const orderIds = [...new Set(holds.map((h) => h.orderId).filter((id): id is string => id !== null))];
  const recordIds = [...new Set(holds.map((h) => h.recordId).filter((id): id is string => id !== null))];
  const [orders, records] = await Promise.all([
    prisma.extrasOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, recordId: true, slot: true, status: true },
    }),
    prisma.bookingRecord.findMany({
      where: { id: { in: recordIds } },
      select: { id: true, status: true, apaleoReservationId: true, reservations: true },
    }),
  ]);

  // Apaleo counts per lodge that has confirmed order-holds.
  const lodges = new Set(
    holds
      .filter((h) => h.kind === "ORDER" && h.status === "CONFIRMED" && h.recordId && h.slot !== null)
      .map((h) => `${h.recordId}|${h.slot}`),
  );
  const apaleoCounts: Array<{ recordId: string; slot: number; serviceCode: string; count: number }> = [];
  const unreadable = new Set<string>();
  for (const key of lodges) {
    const [recordId, slotText] = key.split("|");
    const slot = Number(slotText);
    const record = records.find((r) => r.id === recordId);
    if (!record) continue;
    const reservationId =
      record.reservations.find((r) => r.slot === slot)?.apaleoReservationId ??
      (slot === 0 ? record.apaleoReservationId : null);
    if (!reservationId) continue;
    try {
      const services = await getReservationServices(reservationId);
      for (const line of services) {
        apaleoCounts.push({ recordId, slot, serviceCode: line.code, count: line.count });
      }
    } catch (err) {
      console.error("[inventory] reconcile could not read Apaleo services", reservationId, err);
      unreadable.add(key);
    }
  }

  const violations = findDrift({
    now,
    resources: resources.map((r) => ({ id: r.id, code: r.code, apaleoServiceCode: r.apaleoServiceCode, kind: r.kind })),
    days: days.map((d) => ({ resourceId: d.resourceId, date: d.date, taken: d.taken })),
    holds: holds.map((h) => ({
      resourceId: h.resourceId,
      date: h.date,
      qty: h.qty,
      status: h.status,
      kind: h.kind,
      ownerKey: h.ownerKey,
      orderId: h.orderId,
      recordId: h.recordId,
      slot: h.slot,
      expiresAt: h.expiresAt,
    })),
    orders,
    records: records.map((r) => ({ id: r.id, status: r.status })),
    apaleoCounts,
    unreadable,
  });

  const open = await prisma.opsAlert.findMany({
    where: { kind: "inventory_drift", resolvedAt: null },
    select: { detail: true },
  });
  const openDetails = new Set(open.map((a) => a.detail));
  let filed = 0;
  for (const violation of violations) {
    const detail = JSON.stringify(violation);
    if (openDetails.has(detail)) continue;
    await raiseOpsAlert({
      kind: "inventory_drift",
      recordId: "recordId" in violation ? violation.recordId : null,
      summary: driftSummary(violation),
      detail: violation,
    });
    openDetails.add(detail);
    filed += 1;
  }
  return { violations, filed };
}

function driftSummary(d: Drift): string {
  switch (d.kind) {
    case "counter":
      return `Inventory counter off its ledger: ${d.resourceId} on ${d.date} says ${d.taken}, holds say ${d.ledger}`;
    case "orphan_confirmed":
      return `Confirmed hold with no live order behind it (${d.why}): ${d.resourceId} on ${d.date}`;
    case "apaleo_mismatch":
      return `Apaleo and inventory disagree on ${d.serviceCode} for lodge ${d.slot + 1}: Apaleo ${d.apaleo}, holds ${d.ledger}`;
  }
}
