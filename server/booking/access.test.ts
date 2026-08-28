import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assertBookingAccess } from "./access";
import { PublicError } from "../api-helpers";

/**
 * Frozen suite for UNP-19 (docs/mandatory-accounts-plan.md): who may see a
 * booking once accounts are mandatory. Two proofs remain - the owning
 * account, and the unguessable session id the paying browser holds. The
 * reference-plus-email challenge is deleted; these tests pin the deletion.
 */

type AnyRecord = Parameters<typeof assertBookingAccess>[0];

function record(overrides: Partial<{ userId: string | null; sessionId: string; guestEmail: string | null }> = {}): AnyRecord {
  return {
    userId: overrides.userId ?? "user-owner",
    sessionId: overrides.sessionId ?? "sess-123",
    session: { guestEmail: overrides.guestEmail ?? "lead@example.com" },
  } as unknown as AnyRecord;
}

function user(id: string) {
  return { id } as unknown as NonNullable<Parameters<typeof assertBookingAccess>[1]["user"]>;
}

function statusOf(fn: () => void): number | "granted" {
  try {
    fn();
    return "granted";
  } catch (err) {
    if (err instanceof PublicError) return err.status;
    throw err;
  }
}

describe("assertBookingAccess under mandatory accounts", () => {
  it("grants the signed-in account that owns the booking", () => {
    expect(statusOf(() =>
      assertBookingAccess(record({ userId: "u1" }), { user: user("u1"), sessionId: null, email: null }),
    )).toBe("granted");
  });

  it("grants the browser holding the booking's session id", () => {
    expect(statusOf(() =>
      assertBookingAccess(record({ sessionId: "sess-abc" }), { user: null, sessionId: "sess-abc", email: null }),
    )).toBe("granted");
  });

  it("answers 401 when no proof is offered, so the UI can ask for sign-in", () => {
    expect(statusOf(() =>
      assertBookingAccess(record(), { user: null, sessionId: null, email: null }),
    )).toBe(401);
  });

  it("treats a signed-in non-owner as no proof (401), never as a wrong guess (404)", () => {
    expect(statusOf(() =>
      assertBookingAccess(record({ userId: "u1" }), { user: user("u2"), sessionId: null, email: null }),
    )).toBe(401);
  });

  it("answers 404 to a wrong session id, never confirming the booking exists", () => {
    expect(statusOf(() =>
      assertBookingAccess(record({ sessionId: "sess-abc" }), { user: null, sessionId: "sess-guessed", email: null }),
    )).toBe(404);
  });

  it("no longer accepts the lead email as proof, even when it is correct", () => {
    // The deleted door. Before UNP-19 this exact call was granted; the email
    // challenge is gone, so a correct lead email alone is just no proof.
    expect(statusOf(() =>
      assertBookingAccess(record({ guestEmail: "lead@example.com" }), {
        user: null,
        sessionId: null,
        email: "lead@example.com",
      }),
    )).toBe(401);
  });

  it("a correct email cannot rescue a wrong session id", () => {
    // Email grants nothing, and the wrong-guess answer for the offered
    // session proof stands.
    expect(statusOf(() =>
      assertBookingAccess(record({ sessionId: "sess-abc", guestEmail: "lead@example.com" }), {
        user: null,
        sessionId: "sess-guessed",
        email: "lead@example.com",
      }),
    )).toBe(404);
  });
});
