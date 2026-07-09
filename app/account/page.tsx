import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { parseChildrenAges } from "@/server/booking/session";
import { partyLabel } from "@/server/booking/party";
import { formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES } from "@/content/lodges";

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

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <h1 className="font-display text-3xl text-forest">
        Your <em>breaks</em>
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        Signed in as {user.email}. Bookings made with this email land here
        automatically.
      </p>

      {records.length === 0 && (
        <div className="mt-8 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-8 text-center">
          <p className="text-foreground/60">No breaks yet.</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg bg-forest text-white px-6 py-3 text-sm font-semibold hover:bg-forest-light"
          >
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
          return (
            <Link
              key={record.id}
              href={`/manage/${record.apaleoBookingId}`}
              className="block rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-5 hover:ring-forest/30 transition"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-forest">
                    {multi ? `${s.lodges.length} lodges` : (lodgeNames || "Lodge")}
                  </p>
                  <p className="mt-0.5 text-sm text-foreground/60">
                    {formatDate(s.arrival)} → {formatDate(s.departure)}
                  </p>
                  <p className="text-sm text-foreground/60">
                    {nightsLabel(nights)} ·{" "}
                    {multi ? lodgeNames : partyLabel(s.adults, parseChildrenAges(s))}
                  </p>
                  <p className="mt-2 text-xs text-foreground/50">
                    Reference{" "}
                    <span className="font-mono tracking-widest">{record.apaleoBookingId}</span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-forest">
                    {formatKes(record.totalGrossAmount)}
                  </p>
                  <span
                    className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                      record.status === "paid"
                        ? "bg-moss/15 text-moss"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {record.status === "paid" ? "Paid" : "Payment pending"}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
