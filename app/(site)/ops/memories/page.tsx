import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { countMemories, MEMORIES_GOAL } from "@/server/memories";

/**
 * The memories metric, internal-only since the campaign left the guest
 * site. Gate matches /ops/referrals: signed-out goes to login, signed-in
 * non-admin gets a 404.
 */
export default async function MemoriesOpsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ops/memories");
  if (!user.isAdmin) notFound();

  const memories = await countMemories();

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink">Memories</h1>
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
        One memory is one guest on one paid stay. The count is real paid
        bookings in our database plus the 12,850 baseline from before the
        counter existed, against the one-billion goal. Internal metric only:
        it is no longer shown to guests.
      </p>

      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        <p className="font-display text-5xl font-bold tabular-nums text-olive">
          {memories.toLocaleString("en-GB")}
        </p>
        <p className="mt-3 text-sm text-foreground">
          Goal: {MEMORIES_GOAL.toLocaleString("en-GB")} ·{" "}
          {(MEMORIES_GOAL - memories).toLocaleString("en-GB")} still to go.
        </p>
      </section>
    </div>
  );
}
