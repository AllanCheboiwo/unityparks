import "server-only";
import { isOfferWindowOpen } from "@/lib/repeatOffer";

/**
 * Who gets the post-stay reminder email (docs/promo-codes-plan.md,
 * section 10). The ONLY place consent appears in the feature: eligibility
 * and redemption never read it (invariant 7). Stamped records are done
 * whether or not Resend succeeded; the ops overview owns the follow-up.
 */

export type NotifyCandidate = {
  status: string; // created | deposit_paid | paid | failed | cancelled
  departure: string; // ISO date
  leadMarketingEmail: boolean;
  offerEmailSentAt: string | null;
};

export function isOfferNotifiable(candidate: NotifyCandidate, todayIso: string): boolean {
  return (
    candidate.status === "paid" &&
    candidate.leadMarketingEmail &&
    candidate.offerEmailSentAt == null &&
    isOfferWindowOpen({ departure: candidate.departure, todayIso })
  );
}
