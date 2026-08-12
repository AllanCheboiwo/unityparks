import "server-only";
import type { ReferralConfig, ReferralParticipant } from "@prisma/client";
import { prisma } from "../db";
import { normalizeEmail } from "../auth/normalize";
import { configInForce, isValidCodeFormat, normalizeReferralCode } from "@/lib/referral";

/**
 * Code validation, shared by the advisory endpoint (details step) and the
 * authoritative re-check inside ensureRecord. Same rules both times; only
 * the consequences differ (a hint vs a refused checkout).
 */

export type CodeRefusal = "unknown_code" | "revoked" | "self_use" | "no_program";

export type CodeValidation =
  | {
      ok: true;
      participant: ReferralParticipant;
      config: ReferralConfig;
      /** The configured guest discount; the split/cap comes later. */
      discount: number;
      /** Owner booked for someone else while signed in: discount, no reward. */
      gift: boolean;
    }
  | { ok: false; reason: CodeRefusal };

/** Digits-only comparison so "+254 700..." and "0700..." can still match. */
function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const digits = (s: string) => s.replace(/\D/g, "");
  const da = digits(a);
  const db = digits(b);
  if (da.length < 7 || db.length < 7) return false;
  return da.slice(-9) === db.slice(-9);
}

export async function validateReferralCode(input: {
  code: string;
  /** The lead guest's contact, when known (details submitted). */
  guestEmail?: string | null;
  guestPhone?: string | null;
  /** The session's owner stamp, for the gift rule. */
  sessionUserId?: string | null;
}): Promise<CodeValidation> {
  const code = normalizeReferralCode(input.code);
  if (!isValidCodeFormat(code)) return { ok: false, reason: "unknown_code" };

  const participant = await prisma.referralParticipant.findUnique({ where: { code } });
  if (!participant) return { ok: false, reason: "unknown_code" };
  if (participant.revokedAt) return { ok: false, reason: "revoked" };

  const configs = await prisma.referralConfig.findMany();
  const config = configInForce(configs, new Date().toISOString().slice(0, 10));
  if (!config) return { ok: false, reason: "no_program" };

  // Self-use: the person staying is the code's owner. Contact match is the
  // honest boundary of what we can detect (plan section 8).
  const guestEmail = input.guestEmail ? normalizeEmail(input.guestEmail) : null;
  if (guestEmail && participant.email && guestEmail === participant.email) {
    return { ok: false, reason: "self_use" };
  }
  if (phonesMatch(input.guestPhone, participant.phone)) {
    return { ok: false, reason: "self_use" };
  }

  // Gift: the signed-in booker owns the code but someone else is staying.
  const gift = Boolean(participant.userId && input.sessionUserId === participant.userId);

  return { ok: true, participant, config, discount: Math.round(config.guestDiscount), gift };
}

/** The friendly line for each refusal, shared by UI and checkout errors. */
export function refusalMessage(reason: CodeRefusal): string {
  switch (reason) {
    case "self_use":
      return "You can't use your own referral code on your own stay.";
    case "revoked":
    case "unknown_code":
      return "We don't recognise that referral code. Check the spelling or clear the field.";
    case "no_program":
      return "The referral programme isn't running right now.";
  }
}
