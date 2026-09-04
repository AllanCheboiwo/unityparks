import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import type { HoldLine } from "@/lib/inventory";

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
type Db = Tx | PrismaClient;

export type HoldStatus = "HELD" | "CONFIRMED" | "RELEASED";
export type HoldKind = "ORDER" | "ADJUSTMENT";

export type PlaceHoldsInput = {
  /** "order:<extrasOrderId>" for orders; null for adjustments. */
  ownerKey: string | null;
  kind: HoldKind;
  lines: HoldLine[];
  /** Set for HELD order claims; null for adjustments, which are born CONFIRMED. */
  expiresAt: Date | null;
  orderId?: string | null;
  recordId?: string | null;
  slot?: number | null;
  reason?: string | null;
  createdBy?: string | null;
  now?: Date;
};

export type PlaceHoldsResult =
  | { ok: true }
  | {
      ok: false;
      refusal: { resourceId: string; date: string; requested: number; available: number };
    };

class Refused extends Error {
  constructor(public refusal: PlaceHoldsResult & { ok: false }) {
    super("refused");
  }
}

/** A cuid-shaped id for the raw insert; Prisma only fills @default(cuid())
 *  on writes it builds itself. */
function newRowId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

function ordered(lines: HoldLine[]): HoldLine[] {
  return [...lines].sort((a, b) =>
    a.resourceId === b.resourceId
      ? a.date.localeCompare(b.date)
      : a.resourceId.localeCompare(b.resourceId),
  );
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

/** Sweep expired HELD holds on one row, inside the caller's transaction. */
async function sweepRow(tx: Tx, resourceId: string, date: string, now: Date): Promise<number> {
  return flipAndRelease(tx, { resourceId, date, expiresAt: { lt: now } }, ["HELD"]);
}

/**
 * Claim a set of lines as one unit. A replay with the same owner and lines
 * writes the same rows and moves `taken` once: an existing row that is not
 * RELEASED is left alone. All or nothing: if any row refuses, nothing is
 * kept and the refusal names the row.
 */
export async function placeHolds(input: PlaceHoldsInput): Promise<PlaceHoldsResult> {
  const now = input.now ?? new Date();
  const status: HoldStatus = input.kind === "ADJUSTMENT" ? "CONFIRMED" : "HELD";
  try {
    await prisma.$transaction(async (tx) => {
      for (const line of ordered(input.lines)) {
        // Replay: this owner already holds this row, and it still counts.
        if (input.ownerKey) {
          const existing = await tx.inventoryHold.findUnique({
            where: {
              ownerKey_resourceId_date: {
                ownerKey: input.ownerKey,
                resourceId: line.resourceId,
                date: line.date,
              },
            },
            select: { status: true },
          });
          if (existing && existing.status !== "RELEASED") continue;
        }

        // Lazily create the counter row. Native ON CONFLICT, because a burst
        // of first claimants would race a read-then-insert upsert into a
        // unique violation for everyone but the first.
        await tx.$executeRaw`
          INSERT INTO "ResourceDay" (id, "resourceId", date, taken)
          VALUES (${newRowId()}, ${line.resourceId}, ${line.date}, 0)
          ON CONFLICT ("resourceId", date) DO NOTHING`;
        await sweepRow(tx, line.resourceId, line.date, now);

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
            ok: false,
            refusal: {
              resourceId: line.resourceId,
              date: line.date,
              requested: line.qty,
              available: Math.max(0, (resource?.capacity ?? 0) - (day?.taken ?? 0)),
            },
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
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof Refused) return err.refusal;
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
 * through the guarded update; if that refuses, it is reported as oversold
 * rather than pretended (spec 5.5). Already-confirmed rows are a no-op.
 */
export async function confirmHolds(ownerKey: string, now = new Date()): Promise<ConfirmHoldsResult> {
  const rows = await prisma.inventoryHold.findMany({
    where: { ownerKey, status: { in: ["HELD", "RELEASED"] } },
    orderBy: [{ resourceId: "asc" }, { date: "asc" }],
  });
  let confirmed = 0;
  const oversold: ConfirmHoldsResult["oversold"] = [];

  for (const row of rows) {
    if (row.status === "HELD") {
      const flipped = await prisma.inventoryHold.updateMany({
        where: { id: row.id, status: "HELD" },
        data: { status: "CONFIRMED", expiresAt: null },
      });
      if (flipped.count > 0) confirmed += 1;
      continue;
    }
    // RELEASED: swept while in flight. Claim it again, confirmed.
    const placed = await placeHolds({
      ownerKey,
      kind: row.kind as HoldKind,
      lines: [{ resourceId: row.resourceId, date: row.date, qty: row.qty }],
      expiresAt: null,
      orderId: row.orderId,
      recordId: row.recordId,
      slot: row.slot,
      now,
    });
    if (!placed.ok) {
      oversold.push({ resourceId: row.resourceId, date: row.date, qty: row.qty });
      continue;
    }
    await prisma.inventoryHold.updateMany({
      where: { id: row.id, status: "HELD" },
      data: { status: "CONFIRMED", expiresAt: null },
    });
    confirmed += 1;
  }
  return { confirmed, oversold };
}

/** Give an owner's holds back (HELD or CONFIRMED). Idempotent. */
export async function releaseHolds(ownerKey: string, db: Db = prisma): Promise<number> {
  const run = (tx: Tx) => flipAndRelease(tx, { ownerKey }, ["HELD", "CONFIRMED"]);
  return "$transaction" in db ? db.$transaction(run) : run(db);
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
