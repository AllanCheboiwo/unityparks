import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { repeatOfferOverview } from "@/server/repeatOffer/ops";
import { formatDate, formatKes } from "@/lib/format";
import { OFFER_PER_LODGE, OFFER_WINDOW_DAYS } from "@/lib/repeatOffer";
import { RunButton } from "./RunButton";

/**
 * The repeat-guest offer read-out (UNP-7). Gate matches /ops/referrals:
 * signed-out goes to login, signed-in non-admin gets a 404. A read-out,
 * not a control panel: eligibility is structural (verified party
 * membership plus the window), so there is nothing to revoke.
 */
export default async function RepeatOffersOpsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ops/repeat-offers");
  if (!user.isAdmin) notFound();

  const rows = await repeatOfferOverview();

  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground/50";
  const td = "px-3 py-2 text-sm text-foreground";

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink">Repeat-guest offers</h1>
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
        Every fully paid stay inside its {OFFER_WINDOW_DAYS}-day window. Its
        verified party members hold {formatKes(OFFER_PER_LODGE)} off per lodge
        of a new booking, applied when they book signed in. The email goes to
        opted-in leads only; the offer itself needs no email. A notified stamp
        with no arrival at the guest means Resend failed after claiming; that
        record needs a human decision, never a blind re-send.
      </p>

      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        <RunButton />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Record</th>
                <th className={th}>Lead email</th>
                <th className={th}>Departed</th>
                <th className={th}>Book by</th>
                <th className={th}>Notified</th>
                <th className={th}>Redemptions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.recordId} className="border-b border-line">
                  <td className={`${td} font-mono text-xs`}>{row.recordId}</td>
                  <td className={td}>{row.leadEmail ?? "-"}</td>
                  <td className={td}>{formatDate(row.departure)}</td>
                  <td className={td}>{formatDate(row.deadline)}</td>
                  <td className={td}>
                    {row.notifiedAt ? (
                      formatDate(row.notifiedAt.slice(0, 10))
                    ) : (
                      <span className="text-xs text-foreground/50">not yet</span>
                    )}
                  </td>
                  <td className={`${td} font-semibold`}>{row.redemptions}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} py-6 text-foreground/50`} colSpan={6}>
                    No stays inside the offer window right now.
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
