import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { OpsAlert } from "@prisma/client";
import { getCurrentUser } from "@/server/auth/session";
import { alertsOverview } from "@/server/ops/alerts";
import { ResolveButton } from "./ResolveButton";

/**
 * Ops alerts: every money anomaly a settle or cancel noticed and wedged
 * on. Gate matches /ops/referrals: signed-out goes to login, signed-in
 * non-admin gets a 404. Resolution is a statement of "I looked", nothing
 * automatic hangs off it.
 */
export default async function AlertsOpsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ops/alerts");
  if (!user.isAdmin) notFound();

  const { open, resolved } = await alertsOverview();

  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground/50";
  const td = "px-3 py-2 text-sm text-foreground";

  const kindLabel = (kind: string) =>
    kind === "folio_drift"
      ? "Folio drift"
      : kind === "mid_cancel_drift"
        ? "Mid-cancel payment"
        : kind;

  const fmt = (d: Date) =>
    d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const detailBlock = (a: OpsAlert) => {
    let pretty = a.detail;
    try {
      pretty = JSON.stringify(JSON.parse(a.detail), null, 2);
    } catch {
      // stored as-is; show as-is
    }
    return (
      <details>
        <summary className="cursor-pointer text-xs text-foreground/60">diagnostics</summary>
        <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-sand/40 p-2 text-xs">{pretty}</pre>
      </details>
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink">Ops alerts</h1>
        <div className="flex gap-2">
          <Link href="/ops/referrals" className="btn-outline text-sm">
            Referrals
          </Link>
          <Link href="/ops/reminders" className="btn-outline text-sm">
            Reminders
          </Link>
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-foreground">
        Money anomalies the engine refused to guess about: a folio that
        disagrees with our bookkeeping, a payment that landed mid-cancel.
        Each row is also an email when OPS_ALERT_EMAIL is set. Resolving
        only records that a human looked.
      </p>

      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        <h2 className="font-display text-xl font-bold text-ink">
          Open ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="mt-3 text-sm text-foreground/60">Nothing open. Good.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Raised</th>
                  <th className={th}>Kind</th>
                  <th className={th}>What happened</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {open.map((a) => (
                  <tr key={a.id} className="border-b border-line/60 align-top">
                    <td className={td}>{fmt(a.createdAt)}</td>
                    <td className={td}>{kindLabel(a.kind)}</td>
                    <td className={td}>
                      {a.summary}
                      {detailBlock(a)}
                    </td>
                    <td className={td}>
                      <ResolveButton alertId={a.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {resolved.length > 0 && (
        <section className="mt-6 rounded-lg border border-line bg-white p-5">
          <h2 className="font-display text-xl font-bold text-ink">Recently resolved</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Raised</th>
                  <th className={th}>Kind</th>
                  <th className={th}>What happened</th>
                  <th className={th}>Resolved</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((a) => (
                  <tr key={a.id} className="border-b border-line/60 align-top">
                    <td className={td}>{fmt(a.createdAt)}</td>
                    <td className={td}>{kindLabel(a.kind)}</td>
                    <td className={td}>
                      {a.summary}
                      {detailBlock(a)}
                    </td>
                    <td className={td}>
                      {a.resolvedAt ? fmt(a.resolvedAt) : ""}
                      {a.resolvedBy ? ` by ${a.resolvedBy}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
