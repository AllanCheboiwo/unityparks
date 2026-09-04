import { PrismaClient } from "@prisma/client";

/**
 * The v1 activity resources (UNP-6, docs/activity-inventory-plan.md).
 * Upserts by code, so running it twice is free and a capacity change here
 * lands without touching holds. Prices live in Apaleo (provision.ts);
 * this file only says how many exist and how they are capped.
 *
 *   npx tsx --env-file=.env scripts/seed-inventory.ts
 */

const RESOURCES = [
  {
    code: "CYCLE-ADULT",
    name: "Adult cycle",
    kind: "STOCK",
    capacity: 30,
    sessionStart: null,
    sessionMinutes: null,
    apaleoServiceCode: "CYCLE-ADULT",
    openDaysBefore: null,
    capRule: "adults",
  },
  {
    code: "CYCLE-CHILD",
    name: "Child's cycle",
    kind: "STOCK",
    capacity: 15,
    sessionStart: null,
    sessionMinutes: null,
    apaleoServiceCode: "CYCLE-CHILD",
    openDaysBefore: null,
    capRule: "children",
  },
  {
    code: "SPA-1000",
    name: "Spa session, 10:00",
    kind: "SESSION",
    capacity: 20,
    sessionStart: "10:00",
    sessionMinutes: 180,
    apaleoServiceCode: "SPA-SESSION",
    openDaysBefore: 56,
    capRule: "adults",
  },
  {
    code: "SPA-1400",
    name: "Spa session, 14:00",
    kind: "SESSION",
    capacity: 20,
    sessionStart: "14:00",
    sessionMinutes: 180,
    apaleoServiceCode: "SPA-SESSION",
    openDaysBefore: 56,
    capRule: "adults",
  },
] as const;

const prisma = new PrismaClient();
try {
  for (const resource of RESOURCES) {
    await prisma.inventoryResource.upsert({
      where: { code: resource.code },
      create: { ...resource, active: true },
      update: { ...resource },
    });
    console.log(`${resource.code}: capacity ${resource.capacity}`);
  }
  console.log(`inventory: ${RESOURCES.length} resources in place`);
} finally {
  await prisma.$disconnect();
}
