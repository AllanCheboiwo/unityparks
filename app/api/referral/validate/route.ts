import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { getCurrentUser } from "@/server/auth/session";
import { refusalMessage, validateReferralCode } from "@/server/referral/validate";

const ValidateBody = z.object({
  code: z.string().min(1).max(40),
  email: z.string().optional(),
  phone: z.string().optional(),
});

/**
 * Advisory code check for the details step: tells the guest what their code
 * is worth before they commit, exactly like the email-status gate. The
 * authoritative check runs again inside checkout; this response is a hint,
 * never a promise the money path relies on.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
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
      return NextResponse.json({ valid: false, message: refusalMessage(result.reason) });
    }
    return NextResponse.json({
      valid: true,
      discount: result.discount,
      gift: result.gift,
      referrerName: result.participant.name,
    });
  });
}
