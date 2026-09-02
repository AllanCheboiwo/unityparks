import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isVerifiedMember,
  qualifyingStay,
  type StayFacts,
  type StayInvite,
} from "./eligibility";

/**
 * Frozen suite for UNP-7 (docs/promo-codes-plan.md): who holds the offer.
 *
 * Invariant 3 in full: only a verified party member of the earning stay can
 * hold or claim its offer. Membership is the record's owner, or a user with
 * an accepted, unrevoked invite created before the stay departed (the
 * manifest-at-departure rule, decision 5). These functions deliberately
 * take no marketing-consent input of any kind: consent gates notification
 * only, never eligibility (invariant 7).
 *
 * These tests exist in their own right, not leaning on the UNP-20 suite:
 * that suite pins ACCESS outcomes, and this feature promotes the invite
 * table to a MONEY input, so the money reading of it is pinned here.
 */

function invite(overrides: Partial<StayInvite> = {}): StayInvite {
  return {
    acceptedByUserId: overrides.acceptedByUserId ?? "user-guest",
    revokedAt: overrides.revokedAt ?? null,
    createdAtIso: overrides.createdAtIso ?? "2026-08-20T10:00:00Z",
  };
}

function stay(overrides: Partial<StayFacts> = {}): StayFacts {
  return {
    recordId: overrides.recordId ?? "rec-1",
    ownerUserId: overrides.ownerUserId ?? "user-lead",
    status: overrides.status ?? "paid",
    departure: overrides.departure ?? "2026-09-01",
    invites: overrides.invites ?? [],
  };
}

describe("isVerifiedMember", () => {
  it("the record's owner is a member", () => {
    expect(isVerifiedMember("user-lead", stay())).toBe(true);
  });

  it("an accepted, unrevoked invitee is a member", () => {
    expect(
      isVerifiedMember("user-guest", stay({ invites: [invite()] })),
    ).toBe(true);
  });

  it("an unrelated signed-in user is not a member", () => {
    expect(
      isVerifiedMember("user-stranger", stay({ invites: [invite()] })),
    ).toBe(false);
  });

  it("a revoked invite grants nothing, whoever accepted it", () => {
    expect(
      isVerifiedMember(
        "user-guest",
        stay({ invites: [invite({ revokedAt: "2026-09-05T08:00:00Z" })] }),
      ),
    ).toBe(false);
  });

  it("an invite nobody accepted grants nothing", () => {
    expect(
      isVerifiedMember(
        "user-guest",
        stay({ invites: [invite({ acceptedByUserId: null })] }),
      ),
    ).toBe(false);
  });

  it("manifest rule: an invite created after departure confers no offer", () => {
    expect(
      isVerifiedMember(
        "user-guest",
        stay({ invites: [invite({ createdAtIso: "2026-09-03T10:00:00Z" })] }),
      ),
    ).toBe(false);
  });

  it("late acceptance is fine when the invite itself predates departure", () => {
    // Invited before the trip, registered and accepted after coming home.
    expect(
      isVerifiedMember(
        "user-guest",
        stay({ invites: [invite({ createdAtIso: "2026-08-20T10:00:00Z" })] }),
      ),
    ).toBe(true);
  });

  it("manifest boundary runs on property-local time (+02:00), not UTC", () => {
    // 21:59 UTC on the departure day is 23:59 local: still the manifest.
    expect(
      isVerifiedMember(
        "user-guest",
        stay({ invites: [invite({ createdAtIso: "2026-09-01T21:59:00Z" })] }),
      ),
    ).toBe(true);
    // 22:01 UTC is 00:01 local the NEXT day: too late.
    expect(
      isVerifiedMember(
        "user-guest",
        stay({ invites: [invite({ createdAtIso: "2026-09-01T22:01:00Z" })] }),
      ),
    ).toBe(false);
  });

  it("a legacy orphan record (no owner) matches no one as owner", () => {
    expect(isVerifiedMember("user-lead", stay({ ownerUserId: null }))).toBe(false);
  });
});

describe("qualifyingStay", () => {
  const today = "2026-09-10";

  it("finds the owner's paid, departed, in-window stay", () => {
    const s = stay();
    expect(qualifyingStay({ userId: "user-lead", stays: [s], todayIso: today })).toBe(s);
  });

  it("finds a stay through an accepted pre-departure invite", () => {
    const s = stay({ ownerUserId: "user-lead", invites: [invite()] });
    expect(qualifyingStay({ userId: "user-guest", stays: [s], todayIso: today })).toBe(s);
  });

  it("a stay that is not fully paid earns nothing (deposit_paid, created)", () => {
    for (const status of ["deposit_paid", "created", "failed"]) {
      expect(
        qualifyingStay({ userId: "user-lead", stays: [stay({ status })], todayIso: today }),
      ).toBeNull();
    }
  });

  it("a cancelled stay earns nothing: cancel-the-first-stay gaming is impossible", () => {
    expect(
      qualifyingStay({
        userId: "user-lead",
        stays: [stay({ status: "cancelled" })],
        todayIso: today,
      }),
    ).toBeNull();
  });

  it("nothing before departure, nothing after day 31", () => {
    expect(
      qualifyingStay({ userId: "user-lead", stays: [stay()], todayIso: "2026-09-01" }),
    ).toBeNull();
    expect(
      qualifyingStay({ userId: "user-lead", stays: [stay()], todayIso: "2026-10-03" }),
    ).toBeNull();
    expect(
      qualifyingStay({ userId: "user-lead", stays: [stay()], todayIso: "2026-10-02" }),
    ).not.toBeNull();
  });

  it("with two qualifying stays, the most recently departed wins", () => {
    const older = stay({ recordId: "rec-old", departure: "2026-08-20" });
    const newer = stay({ recordId: "rec-new", departure: "2026-08-28" });
    expect(
      qualifyingStay({ userId: "user-lead", stays: [older, newer], todayIso: "2026-09-05" }),
    ).toBe(newer);
    // Order of the input list must not matter.
    expect(
      qualifyingStay({ userId: "user-lead", stays: [newer, older], todayIso: "2026-09-05" }),
    ).toBe(newer);
  });

  it("membership is per stay: an invitee of one stay gets nothing from another", () => {
    const invited = stay({ recordId: "rec-a", invites: [invite()] });
    const notInvited = stay({
      recordId: "rec-b",
      departure: "2026-09-05",
      invites: [],
    });
    expect(
      qualifyingStay({
        userId: "user-guest",
        stays: [invited, notInvited],
        todayIso: today,
      }),
    ).toBe(invited);
  });

  it("no stays, no offer", () => {
    expect(qualifyingStay({ userId: "user-lead", stays: [], todayIso: today })).toBeNull();
  });
});
