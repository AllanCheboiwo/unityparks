import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { getCurrentUser } from "@/server/auth/session";
import { refusalMessage, validateReferralCode } from "@/server/referral/validate";
import { createRateLimiter } from "@/lib/rateLimit";

const ValidateBody = z.object({
  code: z.string().min(1).max(40),
  email: z.string().optional(),
  phone: z.string().optional(),
});

/**
 * This endpoint is public and the code space is guessable, so it is the
 * one referral surface an enumerator would probe (plan v1.4). Three
 * defences, all per address: 10 checks a minute, a 10-minute cooldown
 * after 15 refused codes in a row, and a fixed short delay on every
 * refusal so mass probing pays for itself. In-memory on purpose; see
 * lib/rateLimit.ts for the accepted limits of that.
 */
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxPerWindow: 10,
  failStreakLimit: 15,
  cooldownMs: 10 * 60_000,
});

const REFUSAL_DELAY_MS = 300;

/** First hop of x-forwarded-for (Railway sets it); "unknown" off-proxy. */
function clientAddress(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/**
 * Advisory code check for the details step: tells the guest what their code
 * is worth before they commit, exactly like the email-status gate. The
 * authoritative check runs again inside checkout; this response is a hint,
 * never a promise the money path relies on.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const address = clientAddress(req);
    const gate = limiter.check(address, Date.now());
    if (!gate.allowed) {
      return jsonError(429, "Too many attempts. Please wait a minute and try again.");
    }

    const parsed = ValidateBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Invalid referral code check.");

    const user = await getCurrentUser();
    const result = await validateReferralCode({
      code: parsed.data.code,
      guestEmail: parsed.data.email ?? null,
      guestPhone: parsed.data.phone ?? null,
      sessionUserId: user?.id ?? null,
    });

    if (!result.ok) {
      limiter.recordFailure(address, Date.now());
      await new Promise((resolve) => setTimeout(resolve, REFUSAL_DELAY_MS));
      return NextResponse.json({ valid: false, message: refusalMessage(result.reason) });
    }
    limiter.recordSuccess(address, Date.now());
    return NextResponse.json({
      valid: true,
      discount: result.discount,
      gift: result.gift,
      referrerName: result.participant.name,
    });
  });
}
