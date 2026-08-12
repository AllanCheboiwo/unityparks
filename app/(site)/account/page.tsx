import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { parseChildrenAges } from "@/server/booking/session";
import { partyLabel } from "@/server/booking/party";
import {
  creditHistory,
  pendingCreditBalance,
  vestedCreditBalance,
} from "@/server/referral/derive";
import { formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import { ReferralCard } from "./ReferralCard";

function nightsBetween(arrival: string, departure: string): number {
  return Math.round((Date.parse(departure) - Date.parse(arrival)) / 86_400_000);
}

/** My bookings: rendered entirely from our own DB, zero Apaleo calls, so it
 * costs nothing against the sandbox budget however often it is refreshed. */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  const records = await prisma.bookingRecord.findMany({
    where: { userId: user.id },
    include: { session: { include: { lodges: { orderBy: { slot: "asc" } } } } },
    orderBy: { createdAt: "desc" },
  });

  // The referral card's numbers, derived at read like every referral figure
  // (no stored balances anywhere). Null participant renders the claim card.
  const participant = await prisma.referralParticipant.findUnique({
    where: { userId: user.id },
  });
  const referral =
    participant && !participant.revokedAt
      ? {
          code: participant.code,
          vested: await vestedCreditBalance(participant.id),
          pending: await pendingCreditBalance(participant.id),
          history: (await creditHistory(participant.id)).map((row) => ({
            id: row.id,
            amount: row.amount,
            state: row.state,
            departure: row.departure ? formatDate(row.departure) : null,
          })),
        }
      : null;
  const shareBase = process.env.APP_BASE_URL ?? "http://localhost:3000";

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <h1 className="font-display text-3xl font-bold text-ink">
        Welcome back, <em>{user.firstName}</em>
      </h1>
      <p className="mt-2 text-sm text-foreground">
        Signed in as {user.email}. Breaks booked with this email land here
        automatically.
      </p>

      <ReferralCard participant={referral} shareBase={shareBase} />

      {records.length === 0 && (
        <div className="mt-8 rounded-lg border border-line contour-bg p-8 text-center">
          <p className="text-foreground">
            No breaks yet. Your first happy memories are waiting by the lake.
          </p>
          <Link href="/" className="btn-primary mt-4">
            Plan your first break
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-4">
        {records.map((record) => {
          const s = record.session;
          const multi = s.lodges.length > 1;
          const lodgeNames = s.lodges
            .map((l) => (l.unitGroupCode ? LODGES[l.unitGroupCode]?.name : null))
            .filter(Boolean)
            .join(", ");
          const nights = nightsBetween(s.arrival, s.departure);
          const outstanding = Math.max(
            0,
            Math.round(record.totalGrossAmount - record.paidAmount),
          );
          const overdue =
            record.status === "deposit_paid" &&
            outstanding > 0 &&
            record.balanceDueDate !== null &&
            record.balanceDueDate < new Date().toISOString().slice(0, 10);
          return (
            <div key={record.id} className="rounded-lg border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-lg font-bold text-navy">
                    {multi ? `${s.lodges.length} lodges` : (lodgeNames || "Lodge")}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-foreground">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M3 10h18M8 3v4M16 3v4" />
                    </svg>
                    {formatDate(s.arrival)} to {formatDate(s.departure)}
                  </p>
                  <p className="mt-0.5 text-sm text-foreground">
                    {nightsLabel(nights)} ·{" "}
                    {multi ? lodgeNames : partyLabel(s.adults, parseChildrenAges(s))}
                  </p>
                  <p className="mt-2 text-xs text-foreground/70">
                    Reference{" "}
                    <span className="font-mono font-semibold tracking-widest text-navy">
                      {record.apaleoBookingId}
                    </span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-ink">
                    {formatKes(record.totalGrossAmount)}
                  </p>
                  <span
                    className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                      record.status === "paid"
                        ? "bg-leaf text-white"
                        : record.status === "cancelled"
                          ? "bg-[#6b6b6b] text-white"
                          : overdue
                            ? "border border-[#b3261e] bg-white text-[#b3261e]"
                            : "border border-bronze bg-white text-bronze"
                    }`}
                  >
                    {record.status === "paid"
                      ? "Paid"
                      : record.status === "cancelled"
                        ? "Cancelled"
                        : record.status === "deposit_paid"
                          ? overdue
                            ? "Balance overdue"
                            : "Deposit paid"
                          : "Payment pending"}
                  </span>
                  {record.status === "deposit_paid" && (
                    <p className="mt-1 text-xs text-foreground/70">
                      {formatKes(outstanding)} still to pay
                      {record.balanceDueDate
                        ? ` · due ${formatDate(record.balanceDueDate)}`
                        : ""}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-4 border-t border-line pt-4">
                <Link href={`/manage/${record.apaleoBookingId}`} className="btn-outline text-sm">
                  Manage
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
