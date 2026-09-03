import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isOfferNotifiable, type NotifyCandidate } from "./notify";

/**
 * Frozen suite for UNP-7 (docs/promo-codes-plan.md): who gets the post-stay
 * reminder email. This is the ONLY place consent appears in the whole
 * feature (invariant 7): a guest who never consented keeps the offer and
 * simply hears nothing. The once-only sending mechanics live with the email
 * template suite in server/email/repeatOffer.test.ts.
 */

function candidate(overrides: Partial<NotifyCandidate> = {}): NotifyCandidate {
  return {
    status: overrides.status ?? "paid",
    departure: overrides.departure ?? "2026-09-01",
    leadMarketingEmail: overrides.leadMarketingEmail ?? true,
    offerEmailSentAt:
      overrides.offerEmailSentAt !== undefined ? overrides.offerEmailSentAt : null,
  };
}

describe("isOfferNotifiable", () => {
  const today = "2026-09-10";

  it("notifies a paid, departed, in-window, consented, unstamped record", () => {
    expect(isOfferNotifiable(candidate(), today)).toBe(true);
  });

  it("consent off means no email, and nothing else about the offer changes", () => {
    expect(isOfferNotifiable(candidate({ leadMarketingEmail: false }), today)).toBe(false);
  });

  it("never emails twice: a stamped record is done, whether or not Resend succeeded", () => {
    expect(
      isOfferNotifiable(candidate({ offerEmailSentAt: "2026-09-05T08:00:00Z" }), today),
    ).toBe(false);
  });

  it("no email outside the window: too early or too late", () => {
    expect(isOfferNotifiable(candidate(), "2026-09-01")).toBe(false);
    expect(isOfferNotifiable(candidate(), "2026-10-03")).toBe(false);
  });

  it("no email for a stay that is not fully paid or was cancelled", () => {
    expect(isOfferNotifiable(candidate({ status: "deposit_paid" }), today)).toBe(false);
    expect(isOfferNotifiable(candidate({ status: "cancelled" }), today)).toBe(false);
  });
});
