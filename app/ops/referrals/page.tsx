import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import {
  lockedSpends,
  participantsOverview,
  recentAttributions,
  VELOCITY_ALERT_THRESHOLD,
  VELOCITY_WINDOW_DAYS,
} from "@/server/referral/ops";
import { formatKes } from "@/lib/format";
import { InfluencerForm, ReleaseButton, RevokeButton } from "./OpsClient";

/**
 * Referral operations. Gate: signed-out goes to login, signed-in non-admin
 * gets a 404 (the area's existence stays quiet). All numbers are derived
 * sums; this page stores nothing.
 */
export default async function ReferralOpsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ops/referrals");
  if (!user.isAdmin) notFound();

  const [participants, attributions, locked] = await Promise.all([
    participantsOverview(),
    recentAttributions(),
    lockedSpends(),
  ]);

  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground/50";
  const td = "px-3 py-2 text-sm text-foreground";

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink">Referral operations</h1>
        <Link href="/ops/referrals/payouts" className="btn-outline text-sm">
          Payouts
        </Link>
      </div>

      <section className="mt-8 rounded-lg border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-navy">Participants</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Code</th>
                <th className={th}>Name</th>
                <th className={th}>Kind</th>
                <th className={th}>Rate</th>
                <th className={th}>Referrals</th>
                <th className={th}>{VELOCITY_WINDOW_DAYS}d</th>
                <th className={th}>Owed / credit</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.id} className={`border-b border-line ${p.revokedAt ? "opacity-50" : ""}`}>
                  <td className={`${td} font-mono font-bold tracking-widest`}>{p.code}</td>
                  <td className={td}>
                    {p.name}
                    {p.revokedAt && <span className="ml-1 text-xs text-[#b3261e]">revoked</span>}
                  </td>
                  <td className={td}>{p.kind}</td>
                  <td className={td}>
                    {p.kind === "influencer"
                      ? p.commissionRate != null
                        ? `${(p.commissionRate * 100).toFixed(1)}%`
                        : "default"
                      : "-"}
                  </td>
                  <td className={td}>
                    {p.attributionCount} ({p.earnedCount} earned)
                  </td>
                  <td className={td}>
                    {/* The velocity view: a hot code routes to a human, here. */}
                    {p.recentCount >= VELOCITY_ALERT_THRESHOLD ? (
                      <span className="rounded-full bg-[#b3261e] px-2 py-0.5 text-xs font-bold text-white">
                        {p.recentCount}
                      </span>
                    ) : (
                      p.recentCount
                    )}
                  </td>
                  <td className={td}>{formatKes(p.owed)}{p.pending > 0 ? ` (+${formatKes(p.pending)} pending)` : ""}</td>
                  <td className={td}>
                    <RevokeButton participantId={p.id} revoked={p.revokedAt !== null} />
                  </td>
                </tr>
              ))}
              {participants.length === 0 && (
                <tr><td className={td} colSpan={8}>No participants yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-bold text-ink">Onboard an influencer</h3>
          <p className="mt-1 text-xs text-foreground/60">
            Vetting and the contract happen before this form; this stores the
            outcome. Blank rate means the config default at each booking.
          </p>
          <InfluencerForm />
        </div>
      </section>

      {locked.length > 0 && (
        <section className="mt-6 rounded-lg border border-bronze bg-white p-5">
          <h2 className="font-display text-lg font-bold text-navy">Locked credit</h2>
          <p className="mt-1 text-xs text-foreground/60">
            Credit spent on checkouts that created a booking but never paid.
            Releasing restores the guest&apos;s credit; only do it once the
            abandoned booking is confirmed dead (it is resumable forever).
          </p>
          <div className="mt-3 grid gap-2">
            {locked.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {s.participant.name} ({s.participant.code}) ·{" "}
                  {formatKes(Math.abs(s.amount))} on booking{" "}
                  <span className="font-mono">{s.spentOnSession?.booking?.apaleoBookingId}</span>
                </span>
                <ReleaseButton entryId={s.id} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-navy">Recent attributions</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>When</th>
                <th className={th}>Code</th>
                <th className={th}>Booking</th>
                <th className={th}>Discount</th>
                <th className={th}>Reward</th>
                <th className={th}>State</th>
              </tr>
            </thead>
            <tbody>
              {attributions.map((a) => {
                const lapsed =
                  a.state === "booked" &&
                  !["deposit_paid", "paid"].includes(a.record.status);
                return (
                  <tr key={a.id} className="border-b border-line">
                    <td className={td}>{a.createdAt.toISOString().slice(0, 10)}</td>
                    <td className={`${td} font-mono`}>{a.participant.code}</td>
                    <td className={td}>
                      <span className="font-mono">{a.record.apaleoBookingId}</span>{" "}
                      · {formatKes(a.record.totalGrossAmount)} · {a.record.status}
                    </td>
                    <td className={td}>{formatKes(a.discountAmount)}</td>
                    <td className={td}>
                      {a.gift ? "gift (none)" : formatKes(a.rewardAmount)}
                    </td>
                    <td className={td}>{lapsed ? "lapsed" : a.state}</td>
                  </tr>
                );
              })}
              {attributions.length === 0 && (
                <tr><td className={td} colSpan={6}>No referred bookings yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
