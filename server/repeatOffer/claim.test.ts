import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decideClaim, type ClaimContext } from "./claim";
import { type StayFacts } from "./eligibility";

/**
 * Frozen suite for UNP-7 (docs/promo-codes-plan.md): the claim decision.
 *
 * decideClaim is the whole claim policy as a pure function: given the
 * session's offer snapshot, any live PENDING redemption from an earlier
 * attempt, and fresh facts about the earning stay, it answers adopt, claim,
 * refuse, or none. The executor around it (transactions, the allowance
 * posts, the unique bookingRecordId confirm) is not under test here; the
 * spec's acceptance check covers it, and invariant 2 rests on the schema's
 * unique constraint rather than on application code.
 *
 * The one rule everything else bends around: replay adopts, never
 * re-litigates (spec section 9). A live PENDING redemption means an earlier
 * attempt may already have put the allowance on the folios, so eligibility
 * is never re-run against it. Every refusal below is a FIRST claim refusal.
 */

function stay(overrides: Partial<StayFacts> = {}): StayFacts {
  return {
    recordId: overrides.recordId ?? "rec-earn",
    ownerUserId: overrides.ownerUserId ?? "user-lead",
    status: overrides.status ?? "paid",
    departure: overrides.departure ?? "2026-09-01",
    invites: overrides.invites ?? [],
  };
}

function ctx(overrides: Partial<ClaimContext> = {}): ClaimContext {
  return {
    sessionUserId: overrides.sessionUserId ?? "user-lead",
    snapshot:
      overrides.snapshot !== undefined
        ? overrides.snapshot
        : { earnedByRecordId: "rec-earn", discount: 5000 },
    pending: overrides.pending !== undefined ? overrides.pending : null,
    stay: overrides.stay !== undefined ? overrides.stay : stay(),
    recomputedDiscount: overrides.recomputedDiscount ?? 5000,
    todayIso: overrides.todayIso ?? "2026-09-10",
  };
}

describe("decideClaim: the normal first claim", () => {
  it("claims for a verified owner inside the window", () => {
    expect(decideClaim(ctx())).toEqual({
      action: "claim",
      earnedByRecordId: "rec-earn",
      amount: 5000,
    });
  });

  it("claims for an accepted pre-departure invitee", () => {
    expect(
      decideClaim(
        ctx({
          sessionUserId: "user-guest",
          stay: stay({
            invites: [
              {
                acceptedByUserId: "user-guest",
                revokedAt: null,
                createdAtIso: "2026-08-20T10:00:00Z",
              },
            ],
          }),
        }),
      ),
    ).toMatchObject({ action: "claim", amount: 5000 });
  });

  it("no snapshot and no pending row means nothing to do", () => {
    expect(decideClaim(ctx({ snapshot: null }))).toEqual({ action: "none" });
  });
});

describe("decideClaim: replay adopts, never re-litigates", () => {
  const pending = {
    id: "red-1",
    claimantUserId: "user-lead",
    earnedByRecordId: "rec-earn",
    amount: 5000,
  };

  it("adopts a live PENDING redemption from a crashed attempt", () => {
    expect(decideClaim(ctx({ pending }))).toEqual({
      action: "adopt",
      redemptionId: "red-1",
      amount: 5000,
    });
  });

  it("adopts even when the window lapsed between crash and replay", () => {
    // Day 31 crash, day 32 replay: the crashed allowance may already sit on
    // the folios, so refusing here would violate invariant 1 (a discount
    // with no redemption row). The adversarial find of 2 Sep.
    expect(
      decideClaim(ctx({ pending, todayIso: "2026-10-03" })),
    ).toEqual({ action: "adopt", redemptionId: "red-1", amount: 5000 });
  });

  it("adopts even when membership was revoked after the claim was made", () => {
    expect(
      decideClaim(
        ctx({
          pending,
          sessionUserId: "user-lead",
          stay: stay({ status: "cancelled" }),
        }),
      ),
    ).toEqual({ action: "adopt", redemptionId: "red-1", amount: 5000 });
  });

  it("adopts even when the snapshot was cleared before the replay", () => {
    // An honest-path cleanup can wipe the session snapshot after the crash;
    // the PENDING row alone is the money truth.
    expect(decideClaim(ctx({ pending, snapshot: null }))).toEqual({
      action: "adopt",
      redemptionId: "red-1",
      amount: 5000,
    });
  });

  it("refuses a PENDING row claimed by a different account", () => {
    // Shared machine: user A applied and crashed, user B signed in and
    // retried. B must never finish a booking carrying A's discount.
    expect(
      decideClaim(ctx({ pending, sessionUserId: "user-other" })),
    ).toMatchObject({ action: "refuse", reason: "foreign_claim" });
  });
});

describe("decideClaim: first-claim refusals take the honest path", () => {
  it("refuses when the window expired between apply and Buy now", () => {
    expect(decideClaim(ctx({ todayIso: "2026-10-03" }))).toMatchObject({
      action: "refuse",
      reason: "window_closed",
    });
  });

  it("refuses when membership was revoked mid-funnel", () => {
    // The invitee's seat email was changed while they sat on the pay page.
    expect(
      decideClaim(
        ctx({
          sessionUserId: "user-guest",
          stay: stay({
            invites: [
              {
                acceptedByUserId: "user-guest",
                revokedAt: "2026-09-09T12:00:00Z",
                createdAtIso: "2026-08-20T10:00:00Z",
              },
            ],
          }),
        }),
      ),
    ).toMatchObject({ action: "refuse", reason: "not_member" });
  });

  it("refuses when the earning stay stopped qualifying (cancelled, refunded)", () => {
    expect(
      decideClaim(ctx({ stay: stay({ status: "cancelled" }) })),
    ).toMatchObject({ action: "refuse", reason: "stay_not_eligible" });
    expect(decideClaim(ctx({ stay: null }))).toMatchObject({
      action: "refuse",
      reason: "stay_not_eligible",
    });
  });

  it("refuses a signed-out session outright", () => {
    // Cannot happen post-UNP-19, guarded anyway: the offer is account state.
    expect(decideClaim(ctx({ sessionUserId: null }))).toMatchObject({
      action: "refuse",
      reason: "signed_out",
    });
  });

  it("refuses when the recomputed discount shrank below what was promised", () => {
    // The basket changed and the capped discount no longer covers the number
    // the guest accepted. Same discipline as referral: re-render, never
    // silently charge against a smaller discount than every screen showed.
    expect(
      decideClaim(ctx({ recomputedDiscount: 4000 })),
    ).toMatchObject({ action: "refuse", reason: "discount_shrunk" });
  });

  it("claims the recomputed amount when it grew (a lodge was added)", () => {
    expect(decideClaim(ctx({ recomputedDiscount: 10_000 }))).toMatchObject({
      action: "claim",
      amount: 10_000,
    });
  });
});
