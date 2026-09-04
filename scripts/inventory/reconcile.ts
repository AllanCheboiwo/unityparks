/**
 * Terminal form of POST /api/ops/inventory/reconcile (UNP-6, spec 5.12).
 * The server modules are server-only and cannot load under tsx, so this
 * calls the deployed route with the run secret, which also means it checks
 * whichever environment APP_BASE_URL points at, Railway included. Prints
 * every violation; the route files the new ones as inventory_drift alerts.
 * Reports only; nothing is repaired.
 *
 *   npx tsx --env-file=.env scripts/inventory/reconcile.ts
 *   APP_BASE_URL=https://... INVENTORY_RUN_SECRET=... npx tsx scripts/inventory/reconcile.ts
 */
const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const secret = process.env.INVENTORY_RUN_SECRET;
if (!secret) {
  console.error("INVENTORY_RUN_SECRET is not set; the route needs it (or an admin cookie).");
  process.exit(2);
}

const res = await fetch(`${base}/api/ops/inventory/reconcile`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});
const body = (await res.json().catch(() => null)) as
  | { violations: unknown[]; filed: number }
  | { error?: string }
  | null;
if (!res.ok || !body || !("violations" in body)) {
  console.error(`Reconcile failed: ${res.status} ${JSON.stringify(body)}`);
  process.exit(2);
}
if (body.violations.length === 0) {
  console.log("Reconciled: counters, ledger and Apaleo all agree.");
  process.exit(0);
}
for (const violation of body.violations) console.log(JSON.stringify(violation));
console.log(`${body.violations.length} violation(s), ${body.filed} newly filed as inventory_drift alerts.`);
process.exit(1);

export {};
