import "server-only";
import type { ReferralConfig, ReferralParticipant } from "@prisma/client";
import { prisma } from "../db";
import { normalizeEmail } from "../auth/normalize";
import {
  configInForce,
  isValidCodeFormat,
  matchesPriorContact,
  normalizeReferralCode,
  phonesMatch,
} from "@/lib/referral";

/**
 * Code validation, shared by the advisory endpoint (details step) and the
 * authoritative re-check inside ensureRecord. Same rules both times; only
 * the consequences differ (a hint vs a refused checkout).
 */

export type CodeRefusal =
  | "unknown_code"
  | "revoked"
  | "self_use"
  | "not_first_stay"
  | "no_program";

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

  // First stay only: referral codes are an acquisition instrument, so a
  // lead guest with any prior kept booking (deposit-paid or paid, not
  // cancelled) is refused. Matched on the lead guest's contact, never the
  // booker's account: a past guest gifting a break to a first-timer stays
  // legitimate. "Prior" is any prior booking, not any prior departed stay,
  // or a new guest could book breaks two and three discounted before break
  // one happens. Runs at both check sites like everything above; before
  // details are captured there is no contact yet, so the advisory pass
  // waives it and the authoritative one decides.
  if (guestEmail || input.guestPhone) {
    // Email narrows in the query (stored normalized); phones are stored as
    // typed, so candidates are fetched and compared digits-only in code.
    // A table walk at phone-rows scale, fine for now; a normalized phone
    // column is the upgrade seam if it ever is not.
    const priors = await prisma.bookingRecord.findMany({
      where: {
        status: { in: ["deposit_paid", "paid"] },
        cancelledAt: null,
        session: {
          OR: [
            ...(guestEmail ? [{ guestEmail }] : []),
            ...(input.guestPhone ? [{ guestPhone: { not: null } }] : []),
          ],
        },
      },
      select: { session: { select: { guestEmail: true, guestPhone: true } } },
    });
    const guest = { email: guestEmail, phone: input.guestPhone ?? null };
    if (
      priors.some((r) =>
        matchesPriorContact(guest, { email: r.session.guestEmail, phone: r.session.guestPhone }),
      )
    ) {
      return { ok: false, reason: "not_first_stay" };
    }
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
    case "not_first_stay":
      return "Referral codes are for a first stay with us. Welcome back - your booking works as normal without one.";
    case "revoked":
    case "unknown_code":
      return "We don't recognise that referral code. Check the spelling or clear the field.";
    case "no_program":
      return "The referral programme isn't running right now.";
  }
}
