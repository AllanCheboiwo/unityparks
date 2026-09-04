import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { compareHoldLines, type HoldLine } from "@/lib/inventory";

/**
 * The placement primitive (UNP-6, docs/activity-inventory-plan.md section
 * 5.3). The only gate that counts is one guarded UPDATE per resource-day,
 * inside the transaction that writes the hold rows:
 *
 *   UPDATE "ResourceDay" SET taken = taken + qty
 *   WHERE "resourceId" = r AND date = d
 *     AND taken + qty <= (SELECT capacity FROM "InventoryResource" ...)
 *
 * Zero rows affected means sold out; the transaction rolls back. The row
 * lock the UPDATE takes is the whole concurrency story. Lines are claimed
 * in (resourceId, date) order so two transactions over the same rows lock
 * them in the same order and cannot deadlock. Before each row is claimed,
 * expired HELD holds on that row are swept, so an abandoned claim never
 * blocks a real one.
 *
 * Every release, wherever it runs, is a guarded status flip: `taken` moves
 * only when the flip affected a row, so two sweeps racing over one expired
 * hold decrement once (invariant 9).
 */

type Tx = Prisma.TransactionClient;

export type HoldStatus = "HELD" | "CONFIRMED" | "RELEASED";
export type HoldKind = "ORDER" | "ADJUSTMENT";

/** The hold identity an extras order claims under. UNP-25 adds a
 *  session-owned variant here, next to the format it has to match. */
export function orderOwnerKey(orderId: string): string {
  return `order:${orderId}`;
}

/** Interactive transactions default to 5 s; a season-long adjustment is
 *  hundreds of guarded updates and needs longer. */
const PLACE_TIMEOUT_MS = 30_000;

export type PlaceHoldsInput = {
  /** "order:<extrasOrderId>" for orders; null for adjustments. */
  ownerKey: string | null;
  kind: HoldKind;
  lines: HoldLine[];
  /** Set for HELD order claims; null for adjustments, which are born CONFIRMED. */
  expiresAt: Date | null;
  /** Orders are born HELD, adjustments CONFIRMED. The late re-place path
   *  (confirmHolds) claims straight into CONFIRMED in one write. */
  status?: HoldStatus;
  orderId?: string | null;
  recordId?: string | null;
  slot?: number | null;
  reason?: string | null;
  createdBy?: string | null;
};

export type PlaceHoldsResult =
  | { ok: true }
  | {
      ok: false;
      refusal: { resourceId: string; date: string; requested: number; available: number };
    };

/** Thrown inside the placement transaction so Prisma rolls it back; caught
 *  at the edge and returned as a plain refusal. */
class Refused extends Error {
  constructor(public refusal: { resourceId: string; date: string; requested: number; available: number }) {
    super("refused");
  }
}

/**
 * Release one set of holds by guarded flip and give their quantity back.
 * Returns how many rows actually flipped. Shared by every release path.
 */
async function flipAndRelease(
  tx: Tx,
  where: Prisma.InventoryHoldWhereInput,
  from: HoldStatus[],
): Promise<number> {
  const rows = await tx.inventoryHold.findMany({
    where: { ...where, status: { in: from } },
    select: { id: true, resourceId: true, date: true, qty: true, status: true },
    orderBy: [{ resourceId: "asc" }, { date: "asc" }],
  });
  let released = 0;
  for (const row of rows) {
    const flipped = await tx.inventoryHold.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: "RELEASED", expiresAt: null },
    });
    if (flipped.count === 0) continue; // someone else flipped it first
    await tx.resourceDay.updateMany({
      where: { resourceId: row.resourceId, date: row.date },
      data: { taken: { decrement: row.qty } },
    });
    released += 1;
  }
  return released;
}


/**
 * Claim a set of lines as one unit. A replay with the same owner and lines
 * writes the same rows and moves `taken` once: an existing row that is not
 * RELEASED is left alone. All or nothing: if any row refuses, nothing is
 * kept and the refusal names the row.
 */
export async function placeHolds(input: PlaceHoldsInput): Promise<PlaceHoldsResult> {
  const now = new Date();
  const status: HoldStatus =
    input.status ?? (input.kind === "ADJUSTMENT" ? "CONFIRMED" : "HELD");
  const lines = [...input.lines].sort(compareHoldLines);
  const rows = lines.map((l) => ({ resourceId: l.resourceId, date: l.date }));
  try {
    await prisma.$transaction(
      async (tx) => {
        // Replay: rows this owner already holds, and that still count, are
        // left alone. One read for the whole batch.
        const alreadyHeld = new Set<string>();
        if (input.ownerKey) {
          const existing = await tx.inventoryHold.findMany({
            where: { ownerKey: input.ownerKey, OR: rows, status: { not: "RELEASED" } },
            select: { resourceId: true, date: true },
          });
          for (const row of existing) alreadyHeld.add(`${row.resourceId}|${row.date}`);
        }

        // Lazily create the counter rows. createMany with skipDuplicates
        // compiles to ON CONFLICT DO NOTHING, so a burst of first claimants
        // cannot race into a unique violation (house pattern, see
        // server/referral/claim.ts).
        await tx.resourceDay.createMany({
          data: rows.map((row) => ({ ...row, taken: 0 })),
          skipDuplicates: true,
        });
        // Sweep expired HELD holds on every row we are about to claim, in
        // (resourceId, date) order, so an abandoned claim never blocks a
        // real one and the locks are still taken in the one order.
        await flipAndRelease(tx, { OR: rows, expiresAt: { lt: now } }, ["HELD"]);

        for (const line of lines) {
          if (alreadyHeld.has(`${line.resourceId}|${line.date}`)) continue;

          const claimed = await tx.$executeRaw`
          UPDATE "ResourceDay"
          SET taken = taken + ${line.qty}
          WHERE "resourceId" = ${line.resourceId} AND date = ${line.date}
            AND taken + ${line.qty} <= (
              SELECT capacity FROM "InventoryResource" WHERE id = ${line.resourceId}
            )`;
          if (claimed === 0) {
            const [day, resource] = await Promise.all([
              tx.resourceDay.findUnique({
                where: { resourceId_date: { resourceId: line.resourceId, date: line.date } },
              }),
              tx.inventoryResource.findUnique({ where: { id: line.resourceId } }),
            ]);
            throw new Refused({
              resourceId: line.resourceId,
              date: line.date,
              requested: line.qty,
              available: Math.max(0, (resource?.capacity ?? 0) - (day?.taken ?? 0)),
            });
          }

          const data = {
            resourceId: line.resourceId,
            date: line.date,
            qty: line.qty,
            status,
            kind: input.kind,
            ownerKey: input.ownerKey,
            orderId: input.orderId ?? null,
            recordId: input.recordId ?? null,
            slot: input.slot ?? null,
            expiresAt: status === "HELD" ? input.expiresAt : null,
            reason: input.reason ?? null,
            createdBy: input.createdBy ?? null,
          };
          if (input.ownerKey) {
            // A RELEASED row for this owner is re-claimed in place (the late
            // confirm path); otherwise this is the first claim.
            await tx.inventoryHold.upsert({
              where: {
                ownerKey_resourceId_date: {
                  ownerKey: input.ownerKey,
                  resourceId: line.resourceId,
                  date: line.date,
                },
              },
              create: data,
              update: { status, qty: line.qty, expiresAt: data.expiresAt },
            });
          } else {
            await tx.inventoryHold.create({ data });
          }
        }
      },
      { timeout: PLACE_TIMEOUT_MS },
    );
    return { ok: true };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, refusal: err.refusal };
    throw err;
  }
}

export type ConfirmHoldsResult = {
  confirmed: number;
  /** Rows that had been swept and could not be re-placed: the order's
   *  money already moved, so the fleet is oversold by these. Never silent. */
  oversold: Array<{ resourceId: string; date: string; qty: number }>;
};

/**
 * Flip an owner's HELD holds to CONFIRMED and clear their expiry. A hold
 * that was swept while the order was in flight (RELEASED) is re-placed
 * through the guarded update straight into CONFIRMED, one write; if that
 * refuses, it is reported as oversold rather than pretended (spec 5.5).
 * A RELEASED row on a record that has since been cancelled was released
 * by the cancellation, not by a sweep, and is left alone. Already-
 * confirmed rows are a no-op.
 */
export async function confirmHolds(ownerKey: string): Promise<ConfirmHoldsResult> {
  const rows = await prisma.inventoryHold.findMany({
    where: { ownerKey, status: { in: ["HELD", "RELEASED"] } },
    orderBy: [{ resourceId: "asc" }, { date: "asc" }],
  });
  let confirmed = 0;
  const oversold: ConfirmHoldsResult["oversold"] = [];

  const flipped = await prisma.inventoryHold.updateMany({
    where: { ownerKey, status: "HELD" },
    data: { status: "CONFIRMED", expiresAt: null },
  });
  confirmed += flipped.count;

  const released = rows.filter((row) => row.status === "RELEASED");
  if (released.length === 0) return { confirmed, oversold };

  const recordId = released[0].recordId;
  if (recordId) {
    const record = await prisma.bookingRecord.findUnique({
      where: { id: recordId },
      select: { status: true },
    });
    if (record?.status === "cancelled") return { confirmed, oversold };
  }

  for (const row of released) {
    const placed = await placeHolds({
      ownerKey,
      kind: row.kind as HoldKind,
      status: "CONFIRMED",
      lines: [{ resourceId: row.resourceId, date: row.date, qty: row.qty }],
      expiresAt: null,
      orderId: row.orderId,
      recordId: row.recordId,
      slot: row.slot,
    });
    if (!placed.ok) {
      oversold.push({ resourceId: row.resourceId, date: row.date, qty: row.qty });
      continue;
    }
    confirmed += 1;
  }
  return { confirmed, oversold };
}

/**
 * The settle transaction's half of confirm: flip an owner's HELD rows to
 * CONFIRMED inside the caller's transaction, so a hold is confirmed if and
 * only if its order settled. Rows swept while the order was in flight are
 * left for confirmHolds to re-place after the transaction commits.
 */
export async function confirmHeldInTx(tx: Tx, ownerKey: string): Promise<number> {
  const flipped = await tx.inventoryHold.updateMany({
    where: { ownerKey, status: "HELD" },
    data: { status: "CONFIRMED", expiresAt: null },
  });
  return flipped.count;
}

/** Give an owner's holds back (HELD or CONFIRMED). Idempotent. */
export async function releaseHolds(ownerKey: string): Promise<number> {
  return prisma.$transaction((tx) => flipAndRelease(tx, { ownerKey }, ["HELD", "CONFIRMED"]));
}

/** Cancellation's step: release every hold a record owns, inside the
 *  caller's transaction so a crash cannot leave a cancelled break holding
 *  stock. Adjustments have no record and are never touched here. */
export async function releaseForRecord(tx: Tx, recordId: string): Promise<number> {
  return flipAndRelease(tx, { recordId }, ["HELD", "CONFIRMED"]);
}

/** The amend route's question: does this break hold activities? */
export async function hasConfirmedHolds(recordId: string): Promise<boolean> {
  const row = await prisma.inventoryHold.findFirst({
    where: { recordId, status: "CONFIRMED" },
    select: { id: true },
  });
  return row !== null;
}

/**
 * The ops sweep: release every expired HELD hold. Correctness never
 * depends on it (placement sweeps lazily); it keeps the ledger tidy and
 * reconciliation cheap. Running it twice is free.
 */
export async function sweepExpired(now = new Date()): Promise<number> {
  return prisma.$transaction((tx) =>
    flipAndRelease(tx, { expiresAt: { lt: now } }, ["HELD"]),
  );
}
