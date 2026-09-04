import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/server/db";
import {
  confirmHolds,
  hasConfirmedHolds,
  placeHolds,
  releaseForRecord,
  releaseHolds,
  sweepExpired,
} from "./holds";

/**
 * Frozen suite for UNP-6 (docs/activity-inventory-plan.md, sections 5.3,
 * 5.5, 5.7, 5.8): the placement primitive against a real Postgres.
 *
 * This file IS the feature. A guarded UPDATE cannot be proven against a
 * mock, so it runs against unity_parks_dev when DATABASE_URL is set and
 * skips with a notice otherwise (vitest.config loads the variable from
 * .env). Every resource it creates carries a per-run prefix and is removed
 * afterwards; the dev database keeps nothing.
 *
 * What is asserted is what the spec guarantees: taken never exceeds
 * capacity under concurrency, all-or-nothing across nights, replays write
 * the same rows, releases never double-decrement, expired holds are free
 * to the next claimant, and a late confirm that finds its stock gone
 * reports oversold rather than pretending.
 */

const dbReady = Boolean(process.env.DATABASE_URL);
if (!dbReady) {
  console.log("holds.db.test.ts skipped: DATABASE_URL is not set");
}

const RUN = `T${Date.now().toString(36)}`;
const NIGHTS = ["2027-03-05", "2027-03-06", "2027-03-07"];
const FAR_FUTURE = new Date("2099-01-01T00:00:00Z");
const PAST = new Date("2000-01-01T00:00:00Z");

let seq = 0;
async function resource(capacity: number) {
  seq += 1;
  return prisma.inventoryResource.create({
    data: {
      code: `${RUN}-R${seq}`,
      name: `Test resource ${seq}`,
      kind: "STOCK",
      capacity,
      apaleoServiceCode: "CYCLE-ADULT",
      capRule: "adults",
      active: true,
    },
  });
}

async function taken(resourceId: string, date: string): Promise<number> {
  const row = await prisma.resourceDay.findUnique({
    where: { resourceId_date: { resourceId, date } },
  });
  return row?.taken ?? 0;
}

async function holdsFor(ownerKey: string) {
  return prisma.inventoryHold.findMany({
    where: { ownerKey },
    orderBy: [{ resourceId: "asc" }, { date: "asc" }],
  });
}

function owner(name: string): string {
  return `order:${RUN}-${name}`;
}

function place(
  ownerKey: string | null,
  resourceId: string,
  dates: string[],
  qty: number,
  extra: Partial<Parameters<typeof placeHolds>[0]> = {},
) {
  return placeHolds({
    ownerKey,
    kind: ownerKey ? "ORDER" : "ADJUSTMENT",
    lines: dates.map((date) => ({ resourceId, date, qty })),
    expiresAt: ownerKey ? FAR_FUTURE : null,
    ...extra,
  });
}

describe.skipIf(!dbReady)("placeHolds: the guarded update", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    const mine = await prisma.inventoryResource.findMany({
      where: { code: { startsWith: `${RUN}-` } },
      select: { id: true },
    });
    const ids = mine.map((r) => r.id);
    await prisma.inventoryHold.deleteMany({ where: { resourceId: { in: ids } } });
    await prisma.resourceDay.deleteMany({ where: { resourceId: { in: ids } } });
    await prisma.inventoryResource.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("places a whole-break hire as one HELD row per night and counts it on every night", async () => {
    const r = await resource(30);
    const result = await place(owner("a"), r.id, NIGHTS, 2);
    expect(result).toMatchObject({ ok: true });
    const rows = await holdsFor(owner("a"));
    expect(rows.map((h) => [h.date, h.qty, h.status])).toEqual(
      NIGHTS.map((d) => [d, 2, "HELD"]),
    );
    for (const d of NIGHTS) expect(await taken(r.id, d)).toBe(2);
  });

  it("refuses the last unit to exactly one of two simultaneous claimants", async () => {
    const r = await resource(1);
    const [a, b] = await Promise.all([
      place(owner("race-a"), r.id, [NIGHTS[0]], 1),
      place(owner("race-b"), r.id, [NIGHTS[0]], 1),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await taken(r.id, NIGHTS[0])).toBe(1);
  });

  it("never lets taken exceed capacity under a burst", async () => {
    const r = await resource(3);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => place(owner(`burst-${i}`), r.id, [NIGHTS[1]], 1)),
    );
    expect(results.filter((x) => x.ok)).toHaveLength(3);
    expect(await taken(r.id, NIGHTS[1])).toBe(3);
  });

  it("a hire that cannot get every night gets none, and names the night that failed", async () => {
    const r = await resource(1);
    expect((await place(owner("first"), r.id, [NIGHTS[1]], 1)).ok).toBe(true);
    const result = await place(owner("second"), r.id, NIGHTS, 1);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.refusal).toMatchObject({ resourceId: r.id, date: NIGHTS[1], available: 0 });
    expect(await taken(r.id, NIGHTS[0])).toBe(0);
    expect(await taken(r.id, NIGHTS[2])).toBe(0);
    expect(await holdsFor(owner("second"))).toHaveLength(0);
  });

  it("a replay with the same owner writes the same rows and moves taken once", async () => {
    const r = await resource(30);
    const first = await place(owner("replay"), r.id, NIGHTS, 2);
    const second = await place(owner("replay"), r.id, NIGHTS, 2);
    expect(first.ok && second.ok).toBe(true);
    expect(await holdsFor(owner("replay"))).toHaveLength(NIGHTS.length);
    for (const d of NIGHTS) expect(await taken(r.id, d)).toBe(2);
  });

  it("an expired hold is free to the next claimant, and is marked released when they take it", async () => {
    const r = await resource(1);
    expect(
      (await place(owner("ghost"), r.id, [NIGHTS[0]], 1, { expiresAt: PAST })).ok,
    ).toBe(true);
    expect(await taken(r.id, NIGHTS[0])).toBe(1);

    const result = await place(owner("real"), r.id, [NIGHTS[0]], 1);
    expect(result.ok).toBe(true);
    expect(await taken(r.id, NIGHTS[0])).toBe(1);
    expect((await holdsFor(owner("ghost")))[0].status).toBe("RELEASED");
    expect((await holdsFor(owner("real")))[0].status).toBe("HELD");
  });

  it("adjustments have no owner, can stack on one day, and are refused past capacity like any claim", async () => {
    const r = await resource(5);
    expect((await place(null, r.id, [NIGHTS[0]], 2, { reason: "workshop" })).ok).toBe(true);
    expect((await place(null, r.id, [NIGHTS[0]], 2, { reason: "staff" })).ok).toBe(true);
    expect(await taken(r.id, NIGHTS[0])).toBe(4);
    const over = await place(null, r.id, [NIGHTS[0]], 2, { reason: "too many" });
    expect(over).toMatchObject({ ok: false });
    expect(await taken(r.id, NIGHTS[0])).toBe(4);
  });
});

describe.skipIf(!dbReady)("confirm, release and sweep", () => {
  it("confirming flips HELD to CONFIRMED, clears the expiry, and a second confirm is a no-op", async () => {
    const r = await resource(30);
    await place(owner("confirm"), r.id, NIGHTS, 1);
    const first = await confirmHolds(owner("confirm"));
    expect(first).toMatchObject({ confirmed: NIGHTS.length, oversold: [] });
    for (const h of await holdsFor(owner("confirm"))) {
      expect(h.status).toBe("CONFIRMED");
      expect(h.expiresAt).toBeNull();
    }
    const again = await confirmHolds(owner("confirm"));
    expect(again).toMatchObject({ confirmed: 0, oversold: [] });
    for (const d of NIGHTS) expect(await taken(r.id, d)).toBe(1);
  });

  it("confirmed holds do not expire: a sweep leaves them and their count alone", async () => {
    const r = await resource(30);
    await place(owner("keep"), r.id, [NIGHTS[0]], 3, { expiresAt: PAST });
    await confirmHolds(owner("keep"));
    await sweepExpired(new Date());
    expect((await holdsFor(owner("keep")))[0].status).toBe("CONFIRMED");
    expect(await taken(r.id, NIGHTS[0])).toBe(3);
  });

  it("a late confirm whose stock was swept and taken by someone else reports oversold instead of pretending", async () => {
    const r = await resource(1);
    await place(owner("late"), r.id, [NIGHTS[0]], 1, { expiresAt: PAST });
    expect((await place(owner("taker"), r.id, [NIGHTS[0]], 1)).ok).toBe(true);

    const result = await confirmHolds(owner("late"));
    expect(result.oversold).toEqual([{ resourceId: r.id, date: NIGHTS[0], qty: 1 }]);
    expect(await taken(r.id, NIGHTS[0])).toBe(1);
  });

  it("a late confirm whose stock was swept but is still free re-places it and confirms", async () => {
    const r = await resource(2);
    await place(owner("late-ok"), r.id, [NIGHTS[0]], 1, { expiresAt: PAST });
    await sweepExpired(new Date());
    expect(await taken(r.id, NIGHTS[0])).toBe(0);

    const result = await confirmHolds(owner("late-ok"));
    expect(result).toMatchObject({ confirmed: 1, oversold: [] });
    expect((await holdsFor(owner("late-ok")))[0].status).toBe("CONFIRMED");
    expect(await taken(r.id, NIGHTS[0])).toBe(1);
  });

  it("releasing gives the count back exactly once, however many times it is called", async () => {
    const r = await resource(30);
    await place(owner("release"), r.id, NIGHTS, 2);
    expect(await releaseHolds(owner("release"))).toBe(NIGHTS.length);
    expect(await releaseHolds(owner("release"))).toBe(0);
    for (const d of NIGHTS) expect(await taken(r.id, d)).toBe(0);
    for (const h of await holdsFor(owner("release"))) expect(h.status).toBe("RELEASED");
  });

  it("two sweeps racing over the same expired holds decrement once", async () => {
    const r = await resource(30);
    await place(owner("sweep-a"), r.id, NIGHTS, 2, { expiresAt: PAST });
    await place(owner("sweep-b"), r.id, NIGHTS, 1, { expiresAt: PAST });
    await Promise.all([sweepExpired(new Date()), sweepExpired(new Date())]);
    for (const d of NIGHTS) expect(await taken(r.id, d)).toBe(0);
  });

  it("running the sweep twice in a row is free", async () => {
    const r = await resource(30);
    await place(owner("sweep-twice"), r.id, [NIGHTS[0]], 2, { expiresAt: PAST });
    expect(await sweepExpired(new Date())).toBeGreaterThanOrEqual(1);
    expect(await sweepExpired(new Date())).toBe(0);
    expect(await taken(r.id, NIGHTS[0])).toBe(0);
  });

  it("cancelling a record releases every confirmed hold it owns, in one transaction, and only those", async () => {
    const r = await resource(30);
    await place(owner("mine"), r.id, NIGHTS, 2, { recordId: `${RUN}-rec-1`, slot: 0 });
    await confirmHolds(owner("mine"));
    await place(owner("theirs"), r.id, NIGHTS, 1, { recordId: `${RUN}-rec-2`, slot: 0 });
    await confirmHolds(owner("theirs"));

    expect(await hasConfirmedHolds(`${RUN}-rec-1`)).toBe(true);
    const released = await prisma.$transaction((tx) => releaseForRecord(tx, `${RUN}-rec-1`));
    expect(released).toBe(NIGHTS.length);
    expect(await hasConfirmedHolds(`${RUN}-rec-1`)).toBe(false);
    expect(await hasConfirmedHolds(`${RUN}-rec-2`)).toBe(true);
    for (const d of NIGHTS) expect(await taken(r.id, d)).toBe(1);
  });
});
