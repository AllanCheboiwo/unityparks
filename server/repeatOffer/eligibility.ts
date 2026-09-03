import "server-only";
import { isOfferWindowOpen } from "@/lib/repeatOffer";

/**
 * Who holds the repeat-guest offer (docs/promo-codes-plan.md, invariant 3):
 * a verified party member of the earning stay, meaning the record's owner
 * or a user with an accepted, unrevoked invite created before the stay
 * departed (the manifest-at-departure rule). A qualifying stay is fully
 * paid, not cancelled, and inside the 31-day window.
 *
 * Pure policy over facts the executor loads. Deliberately takes no
 * marketing-consent input: consent gates notification only (invariant 7).
 */

export type StayInvite = {
  acceptedByUserId: string | null;
  revokedAt: string | null;
  createdAtIso: string; // full timestamp, UTC or offset-carrying
};

export type StayFacts = {
  recordId: string;
  ownerUserId: string | null;
  status: string; // created | deposit_paid | paid | failed | cancelled
  departure: string; // ISO date
  invites: StayInvite[];
};

// The property runs on +02:00 (see server/apaleo/units.ts); the manifest
// closes at local midnight on the departure day, not UTC midnight. This is
// the ONE home of the offset for the offer: derive.ts builds "today" from
// the same helper, so the manifest boundary and the window can never
// disagree about what day it is.
const PROPERTY_UTC_OFFSET_MS = 2 * 60 * 60 * 1000;

/** The property-local calendar day an instant falls on. */
export function propertyDay(iso: string): string {
  return new Date(Date.parse(iso) + PROPERTY_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export function isVerifiedMember(userId: string, stay: StayFacts): boolean {
  if (stay.ownerUserId != null && stay.ownerUserId === userId) return true;
  return stay.invites.some(
    (invite) =>
      invite.acceptedByUserId === userId &&
      invite.revokedAt == null &&
      propertyDay(invite.createdAtIso) <= stay.departure,
  );
}

/**
 * The user's earning stay, or null. With more than one qualifying stay the
 * most recently departed wins; the discount is identical either way, only
 * the bookkeeping differs (spec, decisions made for you).
 */
export function qualifyingStay(input: {
  userId: string;
  stays: StayFacts[];
  todayIso: string;
}): StayFacts | null {
  const qualifying = input.stays.filter(
    (stay) =>
      stay.status === "paid" &&
      isOfferWindowOpen({ departure: stay.departure, todayIso: input.todayIso }) &&
      isVerifiedMember(input.userId, stay),
  );
  if (qualifying.length === 0) return null;
  return qualifying.reduce((best, stay) => (stay.departure > best.departure ? stay : best));
}
