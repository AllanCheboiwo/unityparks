import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { decideAccept, loadInviteForAccept } from "@/server/booking/invites";
import { AcceptClient } from "./AcceptClient";

/**
 * The invite landing page (UNP-20). Signed out it shows who invited you and
 * when, and routes through sign-in or registration with a return here.
 * Signed in it runs the accept decision table. Every dead-token state shows
 * the same neutral copy: this page never confirms a token existed.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="rounded-lg border border-line bg-white p-6">{children}</div>
    </div>
  );
}

function Unavailable() {
  return (
    <Shell>
      <h1 className="font-display text-3xl font-bold text-ink">
        This invitation is no longer <em>available</em>
      </h1>
      <p className="mt-4 text-sm text-foreground">
        The link may have been replaced, or the break it belonged to is no
        longer booked. Ask the person who invited you to check.
      </p>
    </Shell>
  );
}

/** "a***@example.com" */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local?.[0] ?? ""}***@${domain ?? ""}`;
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await loadInviteForAccept(token);
  const cancelled =
    invite !== null &&
    (invite.record.cancelledAt !== null || invite.record.status === "cancelled");
  const user = await getCurrentUser();

  if (!user) {
    if (!invite || invite.revokedAt || cancelled) return <Unavailable />;
    const lead = invite.record.session.guestFirstName ?? "The lead guest";
    const back = `/invite/${token}`;
    return (
      <Shell>
        <h1 className="font-display text-3xl font-bold text-ink">
          You&apos;re invited to a <em>break</em>
        </h1>
        <p className="mt-4 text-sm text-foreground">
          {lead} has added you to their party at Unity Parks Mount Kenya,{" "}
          {invite.record.session.arrival} to {invite.record.session.departure}.
          Sign in or create an account with this email address to see the
          booking.
        </p>
        <div className="mt-6 grid gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(back)}`}
            className="rounded-md bg-navy px-4 py-2.5 text-center text-sm font-semibold text-white"
          >
            Sign in
          </Link>
          <Link
            href={`/register?next=${encodeURIComponent(back)}`}
            className="rounded-md border border-line px-4 py-2.5 text-center text-sm font-semibold text-ink"
          >
            Create an account
          </Link>
        </div>
      </Shell>
    );
  }

  const outcome = decideAccept(invite, {
    userId: user.id,
    userEmail: user.email,
    bookingCancelled: cancelled,
  });

  if (outcome === "already") redirect(`/manage/${invite!.record.apaleoBookingId}`);
  if (outcome === "wrong-email") {
    return (
      <Shell>
        <h1 className="font-display text-3xl font-bold text-ink">
          This invitation is for a <em>different address</em>
        </h1>
        <p className="mt-4 text-sm text-foreground">
          It was sent to {maskEmail(invite!.email)}. Sign in with the account
          that uses that address to accept it.
        </p>
      </Shell>
    );
  }
  if (outcome !== "accept") return <Unavailable />;

  return (
    <Shell>
      <h1 className="font-display text-3xl font-bold text-ink">
        Join this <em>break</em>
      </h1>
      <p className="mt-4 text-sm text-foreground">
        {invite!.record.session.guestFirstName ?? "The lead guest"} has added
        you to their party, {invite!.record.session.arrival} to{" "}
        {invite!.record.session.departure}. Accepting links this booking to
        your account so you can see the shared itinerary.
      </p>
      <AcceptClient token={token} />
    </Shell>
  );
}
