import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  INVITE_LIFETIME_CAP,
  decideAccept,
  planReconcile,
  redactBookingForInvitee,
  type InviteRow,
  type ReconcileInput,
  type SeatRow,
} from "./invites";

/**
 * Frozen suite for UNP-20 (docs/invite-a-guest-plan.md): the invite rules.
 *
 * planReconcile is the whole policy as a pure function: given the seats, the
 * invite rows and the party shape, it answers which invites to revoke and
 * which to create. The executor around it owns transactions and claims and
 * is not under test here. decideAccept is the accept page's decision table.
 * redactBookingForInvitee is the guarantee that an invited guest never sees
 * money or another guest's private details.
 *
 * Emails in every input here are already normalized (lowercased); that is a
 * stated precondition of the module, done by saveGuests and the User schema,
 * not something these functions re-do.
 */

function seat(overrides: Partial<SeatRow> = {}): SeatRow {
  return {
    guestId: overrides.guestId ?? "seat-a",
    slot: overrides.slot ?? 0,
    position: overrides.position ?? 1,
    isLead: overrides.isLead ?? false,
    email: overrides.email ?? null,
  };
}

function invite(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: overrides.id ?? "inv-1",
    guestId: overrides.guestId ?? "seat-a",
    email: overrides.email ?? "party@example.com",
    revokedAt: overrides.revokedAt ?? null,
    acceptedAt: overrides.acceptedAt ?? null,
    acceptedByUserId: overrides.acceptedByUserId ?? null,
  };
}

/** Two adults and a child in one lodge unless a test says otherwise. */
function input(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    cancelled: overrides.cancelled ?? false,
    leadEmail: overrides.leadEmail ?? "lead@example.com",
    bandsBySlot: overrides.bandsBySlot ?? { 0: ["adult", "adult", "child"] },
    seats: overrides.seats ?? [],
    invites: overrides.invites ?? [],
  };
}

describe("planReconcile: who gets invited", () => {
  it("invites an adult, non-lead seat that carries an email", () => {
    const plan = planReconcile(
      input({ seats: [seat({ email: "party@example.com" })] }),
    );
    expect(plan.create).toEqual([
      { guestId: "seat-a", email: "party@example.com" },
    ]);
    expect(plan.revoke).toEqual([]);
  });

  it("never invites the lead booker's own address", () => {
    const plan = planReconcile(
      input({ seats: [seat({ email: "lead@example.com" })] }),
    );
    expect(plan.create).toEqual([]);
  });

  it("never invites the lead seat itself, whatever address it carries", () => {
    const plan = planReconcile(
      input({
        seats: [seat({ guestId: "seat-lead", position: 0, isLead: true, email: "other@example.com" })],
      }),
    );
    expect(plan.create).toEqual([]);
  });

  it("collapses the same address in two seats onto the earlier seat, one invite", () => {
    const plan = planReconcile(
      input({
        bandsBySlot: { 0: ["adult", "adult"], 1: ["adult", "adult"] },
        seats: [
          seat({ guestId: "seat-late", slot: 1, position: 0, email: "twice@example.com" }),
          seat({ guestId: "seat-early", slot: 0, position: 1, email: "twice@example.com" }),
        ],
      }),
    );
    expect(plan.create).toEqual([
      { guestId: "seat-early", email: "twice@example.com" },
    ]);
  });

  it("invites two seats with two different addresses independently", () => {
    const plan = planReconcile(
      input({
        seats: [
          seat({ guestId: "seat-a", position: 1, email: "one@example.com" }),
          seat({ guestId: "seat-b", position: 2, email: "two@example.com" }),
        ],
        bandsBySlot: { 0: ["adult", "adult", "adult"] },
      }),
    );
    expect([...plan.create].sort((a, b) => a.guestId.localeCompare(b.guestId))).toEqual([
      { guestId: "seat-a", email: "one@example.com" },
      { guestId: "seat-b", email: "two@example.com" },
    ]);
  });

  it("never invites a seat the party shape says is a child", () => {
    // Position 2 is the child band in the default shape.
    const plan = planReconcile(
      input({ seats: [seat({ guestId: "seat-child", position: 2, email: "kid@example.com" })] }),
    );
    expect(plan.create).toEqual([]);
  });
});

describe("planReconcile: following the seats as they change", () => {
  it("leaves a seat alone when its email matches its live invite", () => {
    const plan = planReconcile(
      input({
        seats: [seat({ email: "party@example.com" })],
        invites: [invite({ email: "party@example.com" })],
      }),
    );
    expect(plan.create).toEqual([]);
    expect(plan.revoke).toEqual([]);
  });

  it("revokes the old invite and issues a new one when the email changes", () => {
    const plan = planReconcile(
      input({
        seats: [seat({ email: "new@example.com" })],
        invites: [invite({ id: "inv-old", email: "old@example.com" })],
      }),
    );
    expect(plan.revoke).toEqual(["inv-old"]);
    expect(plan.create).toEqual([
      { guestId: "seat-a", email: "new@example.com" },
    ]);
  });

  it("revokes without replacing when the email is cleared", () => {
    const plan = planReconcile(
      input({
        seats: [seat({ email: null })],
        invites: [invite({ id: "inv-old" })],
      }),
    );
    expect(plan.revoke).toEqual(["inv-old"]);
    expect(plan.create).toEqual([]);
  });

  it("never resurrects a revoked row: a returning address gets a fresh invite", () => {
    const plan = planReconcile(
      input({
        seats: [seat({ email: "party@example.com" })],
        invites: [invite({ id: "inv-dead", email: "party@example.com", revokedAt: new Date() })],
      }),
    );
    expect(plan.revoke).toEqual([]);
    expect(plan.create).toEqual([
      { guestId: "seat-a", email: "party@example.com" },
    ]);
  });

  it("revokes an invite whose seat fell outside the party shape after an amend", () => {
    // The lodge now holds one adult; the invited seat sat at position 1.
    const plan = planReconcile(
      input({
        bandsBySlot: { 0: ["adult"] },
        seats: [seat({ position: 1, email: "party@example.com" })],
        invites: [invite({ id: "inv-gone", email: "party@example.com" })],
      }),
    );
    expect(plan.revoke).toEqual(["inv-gone"]);
    expect(plan.create).toEqual([]);
  });

  it("revokes an invite whose seat position now maps to a child band", () => {
    const plan = planReconcile(
      input({
        bandsBySlot: { 0: ["adult", "child"] },
        seats: [seat({ position: 1, email: "party@example.com" })],
        invites: [invite({ id: "inv-shrunk", email: "party@example.com" })],
      }),
    );
    expect(plan.revoke).toEqual(["inv-shrunk"]);
    expect(plan.create).toEqual([]);
  });

  it("does nothing at all on a cancelled booking", () => {
    const plan = planReconcile(
      input({
        cancelled: true,
        seats: [seat({ email: "new@example.com" })],
        invites: [invite({ id: "inv-old", email: "old@example.com" })],
      }),
    );
    expect(plan.revoke).toEqual([]);
    expect(plan.create).toEqual([]);
  });
});

describe("planReconcile: the lifetime cap", () => {
  function nRows(n: number): InviteRow[] {
    return Array.from({ length: n }, (_, i) =>
      invite({ id: `inv-${i}`, guestId: "seat-churned", email: `old-${i}@example.com`, revokedAt: new Date() }),
    );
  }

  it("still creates below the cap", () => {
    const plan = planReconcile(
      input({
        seats: [seat({ email: "party@example.com" })],
        invites: nRows(INVITE_LIFETIME_CAP - 1),
      }),
    );
    expect(plan.create).toHaveLength(1);
  });

  it("stops creating at the cap but still revokes", () => {
    const rows = nRows(INVITE_LIFETIME_CAP - 1);
    rows.push(invite({ id: "inv-live", guestId: "seat-a", email: "old@example.com" }));
    const plan = planReconcile(
      input({
        seats: [seat({ email: "new@example.com" })],
        invites: rows,
      }),
    );
    expect(plan.revoke).toEqual(["inv-live"]);
    expect(plan.create).toEqual([]);
  });
});

describe("planReconcile: settling twice changes nothing", () => {
  it("running the plan over its own result is a no-op", () => {
    const first = planReconcile(
      input({
        seats: [
          seat({ guestId: "seat-a", position: 1, email: "one@example.com" }),
          seat({ guestId: "seat-b", position: 2, email: "two@example.com" }),
        ],
        bandsBySlot: { 0: ["adult", "adult", "adult"] },
        invites: [invite({ id: "inv-stale", guestId: "seat-a", email: "stale@example.com" })],
      }),
    );

    // Apply the plan the way any faithful executor would.
    const after: InviteRow[] = [
      invite({ id: "inv-stale", guestId: "seat-a", email: "stale@example.com", revokedAt: new Date() }),
      ...first.create.map((c, i) => invite({ id: `inv-new-${i}`, guestId: c.guestId, email: c.email })),
    ];
    const second = planReconcile(
      input({
        seats: [
          seat({ guestId: "seat-a", position: 1, email: "one@example.com" }),
          seat({ guestId: "seat-b", position: 2, email: "two@example.com" }),
        ],
        bandsBySlot: { 0: ["adult", "adult", "adult"] },
        invites: after,
      }),
    );
    expect(second.revoke).toEqual([]);
    expect(second.create).toEqual([]);
  });
});

describe("decideAccept: the accept page's decision table", () => {
  const me = { userId: "user-me", userEmail: "party@example.com" };

  it("accepts a live, unaccepted invite whose address matches the account", () => {
    expect(decideAccept(invite(), { ...me, bookingCancelled: false })).toBe("accept");
  });

  it("answers unavailable for an unknown token", () => {
    expect(decideAccept(null, { ...me, bookingCancelled: false })).toBe("unavailable");
  });

  it("answers unavailable for a revoked invite, even with the right address", () => {
    expect(
      decideAccept(invite({ revokedAt: new Date() }), { ...me, bookingCancelled: false }),
    ).toBe("unavailable");
  });

  it("answers unavailable on a cancelled booking, even for the accepted user", () => {
    expect(
      decideAccept(invite({ acceptedAt: new Date(), acceptedByUserId: "user-me" }), {
        ...me,
        bookingCancelled: true,
      }),
    ).toBe("unavailable");
  });

  it("refuses the wrong account without accepting: wrong-email, never auto-accept", () => {
    expect(
      decideAccept(invite(), {
        userId: "user-other",
        userEmail: "other@example.com",
        bookingCancelled: false,
      }),
    ).toBe("wrong-email");
  });

  it("tells the accepted user they are already in", () => {
    expect(
      decideAccept(invite({ acceptedAt: new Date(), acceptedByUserId: "user-me" }), {
        ...me,
        bookingCancelled: false,
      }),
    ).toBe("already");
  });

  it("revocation beats the wrong-email answer: a revoked token is unavailable to everyone", () => {
    // Answering wrong-email here would tell a stranger the token was real.
    expect(
      decideAccept(invite({ revokedAt: new Date() }), {
        userId: "user-other",
        userEmail: "other@example.com",
        bookingCancelled: false,
      }),
    ).toBe("unavailable");
  });

  it("answers unavailable on a cancelled booking before anyone accepts", () => {
    expect(decideAccept(invite(), { ...me, bookingCancelled: true })).toBe("unavailable");
  });

  it("answers unavailable when a different account already accepted", () => {
    expect(
      decideAccept(invite({ acceptedAt: new Date(), acceptedByUserId: "user-else" }), {
        ...me,
        bookingCancelled: false,
      }),
    ).toBe("unavailable");
  });
});

describe("redactBookingForInvitee: what an invited guest may see", () => {
  /** The full owner DTO, shaped like the booking GET route's response, with
   * every money field a distinctive planted value. */
  function ownerDto() {
    return {
      bookingId: "APALEO-1",
      reservationId: "RES-1",
      status: "deposit_paid",
      paidAt: "2026-08-01T10:00:00.000Z",
      cancelledAt: null,
      refundAmount: 111111,
      totalGrossAmount: 222222,
      currency: "KES",
      depositAmount: 333333,
      balanceDueDate: "2026-10-05",
      paidAmount: 444444,
      folioBalance: 555555,
      account: { status: "ownedByYou" },
      referral: { code: "REF-1", discount: 666666 },
      creditApplied: 777777,
      paymentId: "PAY-1",
      stay: {
        arrival: "2026-11-30",
        departure: "2026-12-04",
        adults: 2,
        unitGroupCode: "CEDAR2",
        stayGrossAmount: 888888,
      },
      lodges: [
        {
          slot: 0,
          unitGroupCode: "CEDAR2",
          stayGrossAmount: 888888,
          partyLabel: "2 adults, 1 child",
          extras: [{ code: "BBQ", amount: 999999 }],
          bands: ["adult", "adult", "child"],
          guests: [
            { slot: 0, position: 0, band: "adult", isLead: true, firstName: "Lead", lastName: "Booker", dateOfBirth: "1990-01-01", email: "lead@example.com" },
            { slot: 0, position: 1, band: "adult", isLead: false, firstName: "Party", lastName: "Member", dateOfBirth: "1991-02-02", email: "party@example.com" },
            { slot: 0, position: 2, band: "child", isLead: false, firstName: "Kid", lastName: "Booker", dateOfBirth: "2018-03-03", email: null },
          ],
          assignedUnitName: "Lodge 14",
          locationChoice: "near_lake",
          requestedUnitName: "Lodge 14",
          locationFee: 101010,
          locationFeeDropped: false,
        },
      ],
      extras: [{ code: "BBQ", amount: 999999 }],
      guest: {
        firstName: "Lead",
        lastName: "Booker",
        email: "lead@example.com",
        vehiclePlates: ["KDA 123X"],
      },
    };
  }

  const FORBIDDEN_KEYS = [
    "totalGrossAmount",
    "depositAmount",
    "balanceDueDate",
    "paidAmount",
    "folioBalance",
    "refundAmount",
    "stayGrossAmount",
    "locationFee",
    "discount",
    "creditApplied",
    "paymentId",
    "extras",
    "vehiclePlates",
    "referral",
  ];

  function allKeysDeep(value: unknown, found: Set<string> = new Set()): Set<string> {
    if (Array.isArray(value)) {
      for (const item of value) allKeysDeep(item, found);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        found.add(k);
        allKeysDeep(v, found);
      }
    }
    return found;
  }

  it("carries no money field anywhere, at any depth", () => {
    const view = redactBookingForInvitee(ownerDto(), "party@example.com");
    const keys = allKeysDeep(view);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), `leaked key: ${forbidden}`).toBe(false);
    }
  });

  it("carries none of the planted money values anywhere, at any depth", () => {
    const text = JSON.stringify(redactBookingForInvitee(ownerDto(), "party@example.com"));
    for (const planted of ["111111", "222222", "333333", "444444", "555555", "666666", "777777", "888888", "999999", "101010"]) {
      expect(text.includes(planted), `leaked value: ${planted}`).toBe(false);
    }
  });

  it("keeps what a party member needs: dates, lodge tier, first names", () => {
    const view = redactBookingForInvitee(ownerDto(), "party@example.com") as {
      stay: { arrival: string; departure: string; unitGroupCode: string };
      lodges: Array<{ guests: Array<{ firstName: string | null }> }>;
    };
    expect(view.stay.arrival).toBe("2026-11-30");
    expect(view.stay.departure).toBe("2026-12-04");
    expect(view.stay.unitGroupCode).toBe("CEDAR2");
    expect(view.lodges[0].guests.map((g) => g.firstName)).toEqual(["Lead", "Party", "Kid"]);
  });

  it("collapses payment status to confirmed", () => {
    const view = redactBookingForInvitee(ownerDto(), "party@example.com") as { status: string };
    expect(view.status).toBe("confirmed");
  });

  it("reports a cancelled booking as cancelled", () => {
    const dto = { ...ownerDto(), status: "cancelled", cancelledAt: "2026-09-01T00:00:00.000Z" };
    const view = redactBookingForInvitee(dto, "party@example.com") as { status: string };
    expect(view.status).toBe("cancelled");
  });

  it("hides other guests' surnames and birth dates but keeps the viewer's own", () => {
    const view = redactBookingForInvitee(ownerDto(), "party@example.com") as {
      lodges: Array<{ guests: Array<{ firstName: string | null; lastName: string | null; dateOfBirth: string | null }> }>;
    };
    const guests = view.lodges[0].guests;
    const lead = guests.find((g) => g.firstName === "Lead");
    const viewer = guests.find((g) => g.firstName === "Party");
    const child = guests.find((g) => g.firstName === "Kid");
    expect(lead?.lastName).toBeNull();
    expect(lead?.dateOfBirth ?? null).toBeNull();
    expect(child?.dateOfBirth ?? null).toBeNull();
    expect(viewer?.lastName).toBe("Member");
    expect(viewer?.dateOfBirth).toBe("1991-02-02");
  });

  it("does not leak the lead booker's email address", () => {
    const text = JSON.stringify(redactBookingForInvitee(ownerDto(), "party@example.com"));
    expect(text.includes("lead@example.com")).toBe(false);
  });
});
