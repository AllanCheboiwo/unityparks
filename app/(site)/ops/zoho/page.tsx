import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { formatDate } from "@/lib/format";
import { RunButton } from "./RunButton";

/**
 * The Zoho export outbox (UNP-5). Gate matches the other ops pages:
 * signed-out goes to login, signed-in non-admin gets a 404. A plain table
 * of export rows; failed means automatic retries gave up and the run
 * button is the escalation path. Done rows stay forever - they ARE the
 * duplicate-payment guard.
 */
export default async function ZohoOpsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ops/zoho");
  if (!user.isAdmin) notFound();

  const rows = await prisma.zohoExport.findMany({ orderBy: { createdAt: "desc" } });
  const records = await prisma.bookingRecord.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.bookingId))] } },
    select: { id: true, apaleoBookingId: true },
  });
  const referenceByBooking = new Map(records.map((r) => [r.id, r.apaleoBookingId]));

  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground/50";
  const td = "px-3 py-2 text-sm text-foreground";

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink">Zoho exports</h1>
        <div className="flex gap-2">
          <Link href="/ops/reminders" className="btn-outline text-sm">
            Reminders
          </Link>
          <Link href="/ops/alerts" className="btn-outline text-sm">
            Alerts
          </Link>
          <Link href="/ops/referrals" className="btn-outline text-sm">
            Referrals
          </Link>
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-foreground">
        One row per confirmed Pesapal payment, pushed into Zoho Books as an
        invoice plus a customer payment. Pending rows retry on every payment
        anywhere in the system; failed rows wait for the button below.
      </p>

      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        <RunButton />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Created</th>
                <th className={th}>Booking</th>
                <th className={th}>Tracking id</th>
                <th className={th}>Status</th>
                <th className={th}>Attempts</th>
                <th className={th}>Last error</th>
                <th className={th}>Zoho ids</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line">
                  <td className={td}>{formatDate(row.createdAt.toISOString().slice(0, 10))}</td>
                  <td className={`${td} font-mono font-bold tracking-widest`}>
                    {referenceByBooking.get(row.bookingId) ?? row.bookingId}
                  </td>
                  <td className={`${td} font-mono text-xs`}>{row.trackingId}</td>
                  <td className={td}>
                    {row.status === "done" ? (
                      <span className="rounded-full border border-olive bg-white px-2 py-0.5 text-xs font-semibold text-olive">
                        done
                      </span>
                    ) : row.status === "failed" ? (
                      <span className="rounded-full bg-[#b3261e] px-2 py-0.5 text-xs font-bold text-white">
                        failed
                      </span>
                    ) : (
                      <span className="rounded-full border border-bronze bg-white px-2 py-0.5 text-xs font-semibold text-bronze">
                        {row.status}
                      </span>
                    )}
                  </td>
                  <td className={td}>{row.attempts}</td>
                  <td className={`${td} max-w-xs truncate text-xs`} title={row.lastError ?? ""}>
                    {row.lastError ?? "-"}
                  </td>
                  <td className={`${td} font-mono text-xs`}>
                    {[row.zohoInvoiceId, row.zohoPaymentId].filter(Boolean).join(" / ") || "-"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} py-6 text-foreground/50`} colSpan={7}>
                    No exports yet. The first confirmed Pesapal payment will appear here.
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
