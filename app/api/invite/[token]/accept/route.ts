import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { acceptInvite, decideAccept, loadInviteForAccept } from "@/server/booking/invites";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { createRateLimiter } from "@/lib/rateLimit";

/**
 * Accept a party invite (UNP-20). The token space is 256 random bits, so
 * enumeration is hopeless, but the limiter keeps probing expensive anyway,
 * and every dead-token path answers the same 404 copy: never confirm to a
 * stranger that a token ever existed.
 */
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxPerWindow: 10,
  failStreakLimit: 15,
  cooldownMs: 10 * 60_000,
});

function clientAddress(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

const UNAVAILABLE = "This invitation is no longer available.";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  return handleRoute(async () => {
    const gate = limiter.check(clientAddress(req), Date.now());
    if (!gate.allowed) {
      return jsonError(429, "Too many attempts. Please wait a minute and try again.");
    }

    const user = await getCurrentUser();
    if (!user) return jsonError(401, "Please sign in.");

    const { token } = await params;
    const decision = async () => {
      const invite = await loadInviteForAccept(token);
      return {
        invite,
        outcome: decideAccept(invite, {
          userId: user.id,
          userEmail: user.email,
          bookingCancelled:
            invite !== null &&
            (invite.record.cancelledAt !== null || invite.record.status === "cancelled"),
        }),
      };
    };

    let { invite, outcome } = await decision();
    if (outcome === "accept") {
      const won = await acceptInvite(token, user.id);
      // A lost race means a revoke landed between the read and the update;
      // re-read and let the table name what the token is now.
      if (!won) ({ invite, outcome } = await decision());
      else outcome = "already";
    }

    if (outcome === "already") {
      // Accepted, this call or an earlier one: hand over the booking.
      return NextResponse.json({
        ok: true,
        bookingId: invite!.record.apaleoBookingId,
      });
    }
    if (outcome === "wrong-email") {
      limiter.recordFailure(clientAddress(req), Date.now());
      return jsonError(
        403,
        `This invitation was sent to ${maskEmail(invite!.email)}. Sign in with that account to accept it.`,
      );
    }
    limiter.recordFailure(clientAddress(req), Date.now());
    return jsonError(404, UNAVAILABLE);
  });
}

/** "a***@example.com": enough to recognise your own address, no more. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local?.[0] ?? ""}***@${domain ?? ""}`;
}
