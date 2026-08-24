import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { reminderOverview } from "@/server/booking/reminders";
import { formatKes, formatDate } from "@/lib/format";
import { REMINDER_WINDOW_DAYS } from "@/lib/paymentPlan";
import { RunButton } from "./RunButton";

/**
 * Balance reminders (deposit plan phase 2). Gate matches /ops/referrals:
 * signed-out goes to login, signed-in non-admin gets a 404. The page is a
 * plain list plus the run button; an external scheduler can hit the same
 * run route with the REMINDERS_RUN_SECRET bearer instead.
 */
export default async function RemindersOpsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ops/reminders");
  if (!user.isAdmin) notFound();

  const rows = await reminderOverview();

  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground/50";
  const td = "px-3 py-2 text-sm text-foreground";

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink">Balance reminders</h1>
        <div className="flex gap-2">
          <Link href="/ops/memories" className="btn-outline text-sm">
            Memories
          </Link>
          <Link href="/ops/referrals" className="btn-outline text-sm">
            Referrals
          </Link>
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-foreground">
        Every deposit-paid booking still owing money. A booking gets a
        &quot;due soon&quot; reminder inside the {REMINDER_WINDOW_DAYS} days
        before its due date and an &quot;overdue&quot; one after it, each at
        most once. Nothing is ever cancelled automatically.
      </p>

      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        <RunButton />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Reference</th>
                <th className={th}>Guest email</th>
                <th className={th}>Arrival</th>
                <th className={th}>Due by</th>
                <th className={th}>Outstanding</th>
                <th className={th}>Today</th>
                <th className={th}>Reminded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.recordId} className="border-b border-line">
                  <td className={`${td} font-mono font-bold tracking-widest`}>{row.reference}</td>
                  <td className={td}>{row.guestEmail ?? "-"}</td>
                  <td className={td}>{formatDate(row.arrival)}</td>
                  <td className={td}>{formatDate(row.dueDate)}</td>
                  <td className={`${td} font-semibold`}>{formatKes(row.outstanding)}</td>
                  <td className={td}>
                    {row.stage === "overdue" ? (
                      <span className="rounded-full bg-[#b3261e] px-2 py-0.5 text-xs font-bold text-white">
                        overdue
                      </span>
                    ) : row.stage === "upcoming" ? (
                      <span className="rounded-full border border-bronze bg-white px-2 py-0.5 text-xs font-semibold text-bronze">
                        due soon
                      </span>
                    ) : (
                      <span className="text-xs text-foreground/50">not yet</span>
                    )}
                  </td>
                  <td className={td}>
                    {[
                      row.upcomingSentAt ? "due soon" : null,
                      row.overdueSentAt ? "overdue" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "-"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} py-6 text-foreground/50`} colSpan={7}>
                    No open balances. Every booking is paid in full.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
