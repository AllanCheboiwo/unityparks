import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { claimClientCode } from "@/server/referral/codes";

/** "Get your referral code": creates the client participant on first claim,
 * returns the existing one after. Signed-in users only; any signed-in user
 * may claim (rewards only exist when a referred booking pays). */
export async function POST() {
  return handleRoute(async () => {
    const user = await getCurrentUser();
    if (!user) return jsonError(401, "Please sign in.");
    const participant = await claimClientCode(user);
    if (participant.revokedAt) {
      return jsonError(403, "Your referral code has been deactivated. Contact us if this seems wrong.");
    }
    return NextResponse.json({ code: participant.code });
  });
}
