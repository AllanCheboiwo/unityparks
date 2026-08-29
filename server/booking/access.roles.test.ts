import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assertBookingAccess, resolveBookingAccess } from "./access";
import { PublicError } from "../api-helpers";

/**
 * Frozen suite for UNP-20 (docs/invite-a-guest-plan.md): the invitee role.
 *
 * resolveBookingAccess answers "owner" or "invitee" or throws exactly what
 * assertBookingAccess throws. The invitee role is derived from the invite
 * rows alone: accepted by this user, not revoked, booking not cancelled.
 * The frozen UNP-19 suite (access.test.ts) pins the owner-and-session
 * doors; this file pins the new role and, critically, that the mutating
 * gate assertBookingAccess still refuses invitees.
 */

type Rec = Parameters<typeof resolveBookingAccess>[0];

function record(overrides: Partial<{
  userId: string | null;
  sessionId: string;
  cancelledAt: Date | null;
  invites: Array<{ acceptedByUserId: string | null; revokedAt: Date | null }>;
}> = {}): Rec {
  return {
    userId: overrides.userId ?? "user-owner",
    sessionId: overrides.sessionId ?? "sess-123",
    cancelledAt: overrides.cancelledAt ?? null,
    session: { guestEmail: "lead@example.com" },
    invites: overrides.invites ?? [],
  } as unknown as Rec;
}

function user(id: string) {
  return { id } as unknown as NonNullable<Parameters<typeof resolveBookingAccess>[1]["user"]>;
}

function outcomeOf(fn: () => { role: string }): string | number {
  try {
    return fn().role;
  } catch (err) {
    if (err instanceof PublicError) return err.status;
    throw err;
  }
}

const acceptedInvite = { acceptedByUserId: "user-guest", revokedAt: null };

describe("resolveBookingAccess roles", () => {
  it("names the owning account owner", () => {
    expect(outcomeOf(() =>
      resolveBookingAccess(record({ userId: "u1" }), { user: user("u1"), sessionId: null }),
    )).toBe("owner");
  });

  it("names the paying browser's session id owner", () => {
    expect(outcomeOf(() =>
      resolveBookingAccess(record({ sessionId: "sess-abc" }), { user: null, sessionId: "sess-abc" }),
    )).toBe("owner");
  });

  it("names an accepted, unrevoked invite invitee", () => {
    expect(outcomeOf(() =>
      resolveBookingAccess(record({ invites: [acceptedInvite] }), { user: user("user-guest"), sessionId: null }),
    )).toBe("invitee");
  });

  it("refuses a revoked invite with 401", () => {
    expect(outcomeOf(() =>
      resolveBookingAccess(
        record({ invites: [{ acceptedByUserId: "user-guest", revokedAt: new Date() }] }),
        { user: user("user-guest"), sessionId: null },
      ),
    )).toBe(401);
  });

  it("refuses an invitee once the booking is cancelled, 401", () => {
    expect(outcomeOf(() =>
      resolveBookingAccess(
        record({ cancelledAt: new Date(), invites: [acceptedInvite] }),
        { user: user("user-guest"), sessionId: null },
      ),
    )).toBe(401);
  });

  it("an invite on one booking opens no other: a record without your invite answers 401", () => {
    expect(outcomeOf(() =>
      resolveBookingAccess(record({ invites: [] }), { user: user("user-guest"), sessionId: null }),
    )).toBe(401);
  });

  it("the owner still sees a cancelled booking", () => {
    expect(outcomeOf(() =>
      resolveBookingAccess(record({ userId: "u1", cancelledAt: new Date() }), { user: user("u1"), sessionId: null }),
    )).toBe("owner");
  });

  it("keeps the 401 for no proof at all", () => {
    expect(outcomeOf(() =>
      resolveBookingAccess(record(), { user: null, sessionId: null }),
    )).toBe(401);
  });

  it("keeps the 404 for a wrong session id, never confirming the booking exists", () => {
    expect(outcomeOf(() =>
      resolveBookingAccess(record({ sessionId: "sess-abc" }), { user: null, sessionId: "sess-guessed" }),
    )).toBe(404);
  });
});

describe("the mutating gate stays owner-only", () => {
  it("assertBookingAccess refuses an accepted invitee: reading is not writing", () => {
    // Every mutating route (extras, pay, amend, cancel, guest edits) calls
    // assertBookingAccess. An accepted invite must count for nothing there.
    const rec = record({ invites: [acceptedInvite] });
    let status: number | "granted" = "granted";
    try {
      assertBookingAccess(rec as never, { user: user("user-guest"), sessionId: null });
    } catch (err) {
      if (!(err instanceof PublicError)) throw err;
      status = err.status;
    }
    expect(status).toBe(401);
  });
});
