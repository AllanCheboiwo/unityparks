import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { inventoryOverview, GRID_DAYS } from "@/server/inventory/ops";
import { InventoryClient } from "./InventoryClient";

/**
 * Activities inventory (UNP-6). Gate matches the other ops pages:
 * signed-out goes to login, signed-in non-admin gets a 404. Resources
 * with inline edit, a thirty-day taken-per-day grid, an adjustment form,
 * and the sweep and reconcile buttons. Nobody edits `taken` here: reality
 * is an adjustment with a reason, or a capacity change.
 */
export default async function InventoryOpsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ops/inventory");
  if (!user.isAdmin) notFound();

  const overview = await inventoryOverview();

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink">Activities inventory</h1>
        <div className="flex gap-2">
          <Link href="/ops/alerts" className="btn-outline text-sm">
            Alerts{overview.openAlerts > 0 ? ` (${overview.openAlerts})` : ""}
          </Link>
          <Link href="/ops/reminders" className="btn-outline text-sm">
            Reminders
          </Link>
          <Link href="/ops/referrals" className="btn-outline text-sm">
            Referrals
          </Link>
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-foreground">
        What we sell and how many exist. Availability is never stored: every
        number a guest sees is capacity minus the holds below. A broken bike or
        a walk-in hire is an adjustment with a reason, never an edit to the
        counter. The grid shows the next {GRID_DAYS} days.
      </p>
      <InventoryClient overview={overview} />
    </div>
  );
}
