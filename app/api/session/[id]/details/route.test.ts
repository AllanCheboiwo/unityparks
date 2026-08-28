import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Frozen suite for UNP-19 (docs/mandatory-accounts-plan.md): the details
 * submit is where every booking gains its owner. Signed out, a password is
 * mandatory and mints the account; signed in, the form is a view of the
 * account and a password has no business riding along. The fakes below are
 * dumb storage and recorders - every decision under test belongs to the
 * route.
 */

const db = vi.hoisted(() => ({
  bookingRecord: { findUnique: vi.fn(async (): Promise<unknown> => null) },
  user: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "u-new",
      ...data,
    })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "u1",
      ...data,
    })),
  },
  bookingSession: { updateMany: vi.fn(async () => ({ count: 0 })) },
}));

const bookingSession = vi.hoisted(() => ({
  getSession: vi.fn(async (): Promise<unknown> => null),
  setGuestDetails: vi.fn(
    async (_id: string, _guest: unknown, _userId: string | null) => undefined,
  ),
  setReferralOnSession: vi.fn(async () => undefined),
}));

const auth = vi.hoisted(() => ({
  getCurrentUser: vi.fn(async (): Promise<unknown> => null),
  createAuthSession: vi.fn(async (_userId: string, _remember: boolean) => undefined),
}));

const claim = vi.hoisted(() => ({
  claimByEmail: vi.fn(async (_userId: string, _email: string) => 0),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ prisma: db }));
vi.mock("@/server/booking/session", () => bookingSession);
vi.mock("@/server/auth/session", () => auth);
vi.mock("@/server/auth/claim", () => claim);
vi.mock("@/server/referral/validate", () => ({
  validateReferralCode: vi.fn(async () => ({ ok: false, reason: "unknown" })),
}));
vi.mock("@/server/referral/claim", () => ({
  findClaim: vi.fn(async () => null),
  isLiveClaim: () => false,
  releaseClaim: vi.fn(async () => true),
}));
vi.mock("@/server/email/welcome", () => ({
  sendWelcomeEmail: vi.fn(async () => undefined),
}));

import { POST } from "./route";

const SESSION = {
  id: "sess-1",
  state: "active",
  arrival: "2026-12-18",
  userId: null as string | null,
  referralCode: null as string | null,
};

const SIGNED_IN_USER = {
  id: "u1",
  email: "account@example.com",
  firstName: "Existing",
  lastName: "Account",
  marketingEmail: false,
  marketingSms: false,
};

function guestBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Mr",
    firstName: "Allan",
    lastName: "Guest",
    email: "Lead@Example.com",
    phone: "+254712345678",
    dateOfBirth: "1990-01-01",
    marketingEmail: false,
    marketingSms: false,
    termsAccepted: true,
    ...overrides,
  };
}

async function submit(body: Record<string, unknown>) {
  const req = { json: async () => body } as unknown as NextRequest;
  const res = await POST(req, { params: Promise.resolve({ id: "sess-1" }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.bookingRecord.findUnique.mockResolvedValue(null);
  bookingSession.getSession.mockResolvedValue({ ...SESSION });
  auth.getCurrentUser.mockResolvedValue(null);
});

describe("details submit, signed out", () => {
  it("refuses to book without a password: 400 and nothing written", async () => {
    const { status, body } = await submit(guestBody());
    expect(status).toBe(400);
    // The spec demands a usable message, not a Zod shape error: the guest
    // must learn WHAT was missing. Any honest wording names the password;
    // the exact copy stays free.
    expect(String(body.error).toLowerCase()).toContain("password");
    expect(db.user.create).not.toHaveBeenCalled();
    expect(bookingSession.setGuestDetails).not.toHaveBeenCalled();
  });

  it("refuses a password shorter than 8 characters", async () => {
    const { status } = await submit(guestBody({ password: "seven77" }));
    expect(status).toBe(400);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(bookingSession.setGuestDetails).not.toHaveBeenCalled();
  });

  it("mints the account and stamps the new owner onto the session", async () => {
    const { status, body } = await submit(guestBody({ password: "long enough" }));
    expect(status).toBe(200);
    expect(body.accountCreated).toBe(true);
    // Invariant 1: the walk now has an owner. setGuestDetails is the write
    // that carries ownership to the session row, which checkout later
    // copies onto the record.
    expect(bookingSession.setGuestDetails).toHaveBeenCalledTimes(1);
    expect(bookingSession.setGuestDetails.mock.calls[0][2]).toBe("u-new");
  });

  it("signs the guest in on the way through, so the pay step sees an account", async () => {
    // Call assert, flagged per the workflow rule: reaching the cookie jar
    // from here would mean faking three more layers, and "the guest leaves
    // this submit signed in" is itself the spec line under test.
    await submit(guestBody({ password: "long enough" }));
    expect(auth.createAuthSession).toHaveBeenCalledTimes(1);
    expect(auth.createAuthSession.mock.calls[0][0]).toBe("u-new");
  });

  it("adopts the email's earlier guest bookings at the account moment", async () => {
    // Call assert, same flag as above: adoption on first sign-up is the
    // guarantee (spec: claimByEmail stays), and it is unreachable as an
    // observable outcome with the store faked at this level.
    await submit(guestBody({ password: "long enough" }));
    expect(claim.claimByEmail).toHaveBeenCalledTimes(1);
    expect(claim.claimByEmail.mock.calls[0][0]).toBe("u-new");
    expect(claim.claimByEmail.mock.calls[0][1]).toBe("lead@example.com");
  });

  it("passes keep-me-signed-in through to the auth session", async () => {
    await submit(guestBody({ password: "long enough", remember: true }));
    expect(auth.createAuthSession.mock.calls[0][1]).toBe(true);
  });

  it("defaults keep-me-signed-in to off when the box was not ticked", async () => {
    await submit(guestBody({ password: "long enough" }));
    expect(auth.createAuthSession.mock.calls[0][1]).toBe(false);
  });

  it("answers emailTaken 409 when the email grew an account between check and submit", async () => {
    const { Prisma } = await import("@prisma/client");
    db.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const { status, body } = await submit(guestBody({ password: "long enough" }));
    expect(status).toBe(409);
    expect(body.emailTaken).toBe(true);
    // The loser of the race is not signed in as anyone.
    expect(auth.createAuthSession).not.toHaveBeenCalled();
    expect(bookingSession.setGuestDetails).not.toHaveBeenCalled();
  });
});

describe("details submit, signed in", () => {
  beforeEach(() => {
    auth.getCurrentUser.mockResolvedValue({ ...SIGNED_IN_USER });
    bookingSession.getSession.mockResolvedValue({ ...SESSION, userId: "u1" });
  });

  it("books without a password: the account already exists", async () => {
    const { status, body } = await submit(guestBody());
    expect(status).toBe(200);
    expect(body.accountCreated).toBeFalsy();
    expect(db.user.create).not.toHaveBeenCalled();
    expect(bookingSession.setGuestDetails.mock.calls[0][2]).toBe("u1");
  });

  it("writes the form back to the account profile", async () => {
    await submit(guestBody({ firstName: "Edited" }));
    expect(db.user.update).toHaveBeenCalledTimes(1);
    const call = db.user.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(call.where.id).toBe("u1");
    expect(call.data.firstName).toBe("Edited");
    // The lead-guest email edits the booking, never the account.
    expect(call.data.email).toBeUndefined();
  });

  it("refuses a password riding a signed-in submit: 400, no second account", async () => {
    const { status } = await submit(guestBody({ password: "long enough" }));
    expect(status).toBe(400);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(bookingSession.setGuestDetails).not.toHaveBeenCalled();
  });
});

describe("details submit, frozen once real", () => {
  it("refuses every rewrite once a booking record exists, owner included", async () => {
    db.bookingRecord.findUnique.mockResolvedValue({ id: "rec-1" });
    auth.getCurrentUser.mockResolvedValue({ ...SIGNED_IN_USER });
    const { status } = await submit(guestBody());
    expect(status).toBe(409);
    expect(bookingSession.setGuestDetails).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("tells an expired session to start again: 410", async () => {
    bookingSession.getSession.mockResolvedValue(null);
    const { status } = await submit(guestBody({ password: "long enough" }));
    expect(status).toBe(410);
    expect(db.user.create).not.toHaveBeenCalled();
  });
});
