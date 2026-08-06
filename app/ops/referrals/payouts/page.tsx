import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { payoutsDue } from "@/server/referral/ops";
import { formatKes } from "@/lib/format";
import { RunPayoutBatch } from "../OpsClient";

/** Monthly influencer payouts: what is owed, the CSV for the accountant
 * and the hand-run transfers, and the once-only mark-paid action. */
export default async function ReferralPayoutsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ops/referrals/payouts");
  if (!user.isAdmin) notFound();

  const dues = await payoutsDue();
  const total = dues.reduce((sum, d) => sum + d.owed, 0);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink">Referral payouts</h1>
        <Link href="/ops/referrals" className="btn-outline text-sm">
          Back to operations
        </Link>
      </div>

      <div className="mt-8 rounded-lg border border-line bg-white p-5">
        {dues.length === 0 ? (
          <p className="text-sm text-foreground">
            Nothing is owed right now. Commission matures when the referred
            stay completes on a fully paid booking.
          </p>
        ) : (
          <>
            <div className="grid gap-2">
              {dues.map((d) => (
                <div key={d.participantId} className="flex justify-between text-sm">
                  <span>
                    {d.name} <span className="font-mono">({d.code})</span>
                    {d.phone ? ` · ${d.phone}` : ""}
                  </span>
                  <span className="font-semibold">{formatKes(d.owed)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm font-bold">
              <span>Total</span>
              <span>{formatKes(total)}</span>
            </div>
            <p className="mt-4 text-xs text-foreground/60">
              Export the CSV, run the transfers by hand (WHT per the
              accountant), then mark the batch paid. A batch id can only ever
              run once.
            </p>
            <div className="mt-2">
              <a href="/api/ops/referrals/payouts" className="btn-outline text-sm">
                Export CSV
              </a>
            </div>
            <RunPayoutBatch />
          </>
        )}
      </div>
    </div>
  );
}
