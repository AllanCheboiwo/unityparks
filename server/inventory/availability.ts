import "server-only";
import type { BookingRecord, BookingReservation, BookingSession, SessionLodge } from "@prisma/client";
import { prisma } from "../db";
import { parseChildrenAges } from "../booking/session";
import {
  capFor,
  freeCount,
  freeForStay,
  ownedStockCount,
  resourceWindow,
  stayNights,
  type LodgeParty,
  type OwnedLine,
  type ResourceFacts,
} from "@/lib/inventory";
import { RETIRED_SERVICE_CODES } from "../apaleo/units";
import type {
  ActivitiesDto,
  ActivityLodgeDto,
  ActivityResourceDto,
} from "@/lib/types";

/**
 * What the Activities card reads (UNP-6, spec section 5.9). A local read:
 * resources, counters, expired holds handed back at read time, and this
 * booking's CONFIRMED holds for its owned counts. Apaleo is never touched
 * here; it is asked only on an add. A displayed count is a display, never a
 * promise; the placement at add time is the moment of truth.
 */

export type RecordForActivities = BookingRecord & {
  session: BookingSession & { lodges: SessionLodge[] };
  reservations: BookingReservation[];
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Every Apaleo service code that is governed by inventory or retired: the
 * set nothing may sell as a plain extra, anywhere. Deliberately includes
 * inactive resources (they are not offered, but their service is still
 * stock) and the retired codes (their service may still be on the rate
 * plan if the Apaleo retirement failed).
 */
export async function governedServiceCodes(): Promise<Set<string>> {
  const rows = await prisma.inventoryResource.findMany({
    select: { apaleoServiceCode: true },
  });
  return new Set([...rows.map((r) => r.apaleoServiceCode), ...RETIRED_SERVICE_CODES]);
}

/** Every active resource, in the shape the pure helpers take. */
export async function activeResources(): Promise<ResourceFacts[]> {
  const rows = await prisma.inventoryResource.findMany({
    where: { active: true },
    orderBy: [{ kind: "asc" }, { code: "asc" }],
  });
  return rows.map(resourceFacts);
}

export function resourceFacts(row: {
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
  active: boolean;
}): ResourceFacts {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind === "SESSION" ? "SESSION" : "STOCK",
    capacity: row.capacity,
    sessionStart: row.sessionStart,
    sessionMinutes: row.sessionMinutes,
    apaleoServiceCode: row.apaleoServiceCode,
    openDaysBefore: row.openDaysBefore,
    capRule: row.capRule === "children" ? "children" : "adults",
    active: row.active,
  };
}

/** One lodge's party: the SessionLodge row, or the legacy session-level
 *  party for bookings from before multi-lodge. */
export function lodgeParties(record: RecordForActivities): Array<{ slot: number; party: LodgeParty }> {
  const slots =
    record.reservations.length > 0
      ? record.reservations.map((r) => r.slot)
      : [0];
  return slots.map((slot) => {
    const lodge = record.session.lodges.find((l) => l.slot === slot);
    const source = lodge ?? record.session;
    return { slot, party: { adults: source.adults, childrenAges: parseChildrenAges(source) } };
  });
}

/** This lodge's CONFIRMED holds, summarised per resource and date. The
 *  validator's `owned` input and the card's owned counts both come from
 *  here, so the two can never disagree. */
export async function ownedForLodge(
  recordId: string,
  slot: number,
  resources: ResourceFacts[],
): Promise<OwnedLine[]> {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const holds = await prisma.inventoryHold.findMany({
    where: { recordId, slot, status: "CONFIRMED", kind: "ORDER" },
    select: { resourceId: true, date: true, qty: true },
  });
  const lines: OwnedLine[] = [];
  for (const hold of holds) {
    const resource = byId.get(hold.resourceId);
    if (!resource) continue;
    lines.push({ resourceCode: resource.code, date: hold.date, qty: hold.qty });
  }
  return lines;
}

/** Counter and expired-hold sums per (resource, date) over the stay. */
async function takenByResourceDate(
  resourceIds: string[],
  nights: string[],
  now: Date,
): Promise<Map<string, { taken: number; expiredHeld: number }>> {
  const [days, expired] = await Promise.all([
    prisma.resourceDay.findMany({
      where: { resourceId: { in: resourceIds }, date: { in: nights } },
    }),
    prisma.inventoryHold.groupBy({
      by: ["resourceId", "date"],
      where: {
        resourceId: { in: resourceIds },
        date: { in: nights },
        status: "HELD",
        expiresAt: { lt: now },
      },
      _sum: { qty: true },
    }),
  ]);
  const out = new Map<string, { taken: number; expiredHeld: number }>();
  for (const day of days) {
    out.set(`${day.resourceId}|${day.date}`, { taken: day.taken, expiredHeld: 0 });
  }
  for (const row of expired) {
    const key = `${row.resourceId}|${row.date}`;
    const entry = out.get(key) ?? { taken: 0, expiredHeld: 0 };
    entry.expiredHeld = row._sum.qty ?? 0;
    out.set(key, entry);
  }
  return out;
}

export async function activitiesForRecord(
  record: RecordForActivities,
  options: { today?: string; now?: Date } = {},
): Promise<ActivitiesDto> {
  const today = options.today ?? todayIso();
  const now = options.now ?? new Date();
  const nights = stayNights(record.session.arrival, record.session.departure);
  const resources = await activeResources();
  const taken = await takenByResourceDate(
    resources.map((r) => r.id),
    nights,
    now,
  );

  const lodges: ActivityLodgeDto[] = [];
  for (const { slot, party } of lodgeParties(record)) {
    const owned = await ownedForLodge(record.id, slot, resources);
    const dtos: ActivityResourceDto[] = resources.map((resource) => {
      const window = resourceWindow({
        arrival: record.session.arrival,
        openDaysBefore: resource.openDaysBefore,
        todayIso: today,
      });
      const mine = owned.filter((o) => o.resourceCode === resource.code);
      const base = {
        code: resource.code,
        name: resource.name,
        kind: resource.kind,
        sessionStart: resource.sessionStart,
        sessionMinutes: resource.sessionMinutes ?? null,
        apaleoServiceCode: resource.apaleoServiceCode,
        window,
        cap: capFor(resource, party),
      };
      if (resource.kind === "SESSION") {
        return {
          ...base,
          owned: mine.reduce((sum, o) => sum + o.qty, 0),
          free: null,
          sessions: nights.map((date) => {
            const day = taken.get(`${resource.id}|${date}`);
            return {
              date,
              free: day
                ? freeCount({ capacity: resource.capacity, ...day })
                : resource.capacity,
              owned: mine.filter((o) => o.date === date).reduce((sum, o) => sum + o.qty, 0),
            };
          }),
        };
      }
      const takenByDate: Record<string, { taken: number; expiredHeld: number }> = {};
      for (const date of nights) {
        const day = taken.get(`${resource.id}|${date}`);
        if (day) takenByDate[date] = day;
      }
      return {
        ...base,
        owned: ownedStockCount(mine),
        free: freeForStay({ capacity: resource.capacity, nights, takenByDate }),
        sessions: null,
      };
    });
    lodges.push({ slot, party, resources: dtos });
  }

  return { nights, lodges };
}
