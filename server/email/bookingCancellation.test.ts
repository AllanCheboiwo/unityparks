import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { composeInviteeCancellation, type InviteeCancellationFacts } from "./bookingCancellation";

/**
 * Frozen suite for UNP-20 (docs/invite-a-guest-plan.md), finding C: accepted
 * invitees hear about a cancellation through their own money-free notice,
 * never the owner's email, which carries the refund amount. The facts type
 * has no money field, which is the enforcement; these tests pin what the
 * notice does say.
 */

function facts(overrides: Partial<InviteeCancellationFacts> = {}): InviteeCancellationFacts {
  return {
    leadFirstName: overrides.leadFirstName ?? "Achieng",
    village: overrides.village ?? "Mount Kenya",
    arrival: overrides.arrival ?? "2026-11-30",
    departure: overrides.departure ?? "2026-12-04",
  };
}

describe("composeInviteeCancellation", () => {
  it("says the break was cancelled and which one it was", () => {
    const mail = composeInviteeCancellation(facts());
    for (const body of [mail.subject, mail.text]) {
      expect(body.toLowerCase()).toContain("cancel");
    }
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain("Mount Kenya");
    }
  });

  it("names the lead guest so the notice is not a mystery", () => {
    const mail = composeInviteeCancellation(facts({ leadFirstName: "Wanjiru" }));
    expect(mail.text).toContain("Wanjiru");
  });
});
