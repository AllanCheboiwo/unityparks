import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Frozen suite for UNP-19 (docs/mandatory-accounts-plan.md): the booking
 * page's door, at HTTP level. The reference-plus-email challenge is deleted,
 * so a correct lead email in the query string must open nothing; the
 * unguessable session id from a fresh checkout must keep working, because it
 * is how the just-paid browser reaches its confirmation. Fakes are dumb
 * storage; the access decision under test lives in the route and its gate.
 */

const RECORD = {
  id: "rec-1",
  sessionId: "sess-1",
  apaleoBookingId: "UPNV-1",
  apaleoReservationId: "UPNV-1-1",
  folioId: "folio-1",
  status: "paid",
  paidAt: new Date("2026-08-01T10:00:00Z"),
  cancelledAt: null,
  refundAmount: null,
  totalGrossAmount: 100000,
  paidAmount: 100000,
  currency: "KES",
  depositAmount: 30000,
  balanceDueDate: "2026-10-01",
  userId: "u-owner",
  referralAttribution: null,
  reservations: [],
  // The route's include now loads invites (UNP-20); a faithful prisma
  // result always carries the array. Empty here: no invites on this booking.
  invites: [],
  session: {
    id: "sess-1",
    arrival: "2026-12-18",
    departure: "2026-12-21",
    adults: 2,
    unitGroupCode: "WDL",
    stayGrossAmount: 100000,
    guestFirstName: "Allan",
    guestLastName: "Guest",
    guestEmail: "lead@example.com",
    lodges: [],
  },
};

const db = vi.hoisted(() => ({
  bookingRecord: { findFirst: vi.fn(async (): Promise<unknown> => null) },
  referralLedgerEntry: { findUnique: vi.fn(async (): Promise<unknown> => null) },
  user: { findUnique: vi.fn(async (): Promise<unknown> => null) },
}));

const auth = vi.hoisted(() => ({
  getCurrentUser: vi.fn(async (): Promise<unknown> => null),
}));

const folio = vi.hoisted(() => ({
  getFolioForReservation: vi.fn(async () => ({
    folioId: "folio-1",
    balance: 0,
    currency: "KES",
  })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ prisma: db }));
vi.mock("@/server/auth/session", () => auth);
vi.mock("@/server/apaleo/bookings", () => folio);
vi.mock("@/server/booking/session", () => ({
  parseChildrenAges: () => [],
  parseExtras: () => [],
  parseVehiclePlates: () => [],
}));
vi.mock("@/server/booking/guests", () => ({
  loadGuests: async () => [],
  guestRowDto: (r: unknown) => r,
  partyBands: () => [],
}));

import { GET } from "./route";

function request(query: Record<string, string>) {
  const url = new URL("http://test.local/api/booking/UPNV-1");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

async function fetchBooking(query: Record<string, string>) {
  const res = await GET(request(query), {
    params: Promise.resolve({ bookingId: "UPNV-1" }),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.bookingRecord.findFirst.mockResolvedValue({ ...RECORD });
  auth.getCurrentUser.mockResolvedValue(null);
});

describe("GET /api/booking/[bookingId] under mandatory accounts", () => {
  it("no longer opens for reference plus lead email, even the correct one", async () => {
    const { status } = await fetchBooking({ email: "lead@example.com" });
    // 401, the "no proof offered" answer: the email param grants nothing
    // now, and must not be treated as a wrong guess either.
    expect(status).toBe(401);
    // The gate runs before any Apaleo spend.
    expect(folio.getFolioForReservation).not.toHaveBeenCalled();
  });

  it("still opens for the just-paid browser holding the session id", async () => {
    const { status, body } = await fetchBooking({ session: "sess-1" });
    expect(status).toBe(200);
    expect(body.bookingId).toBe("UPNV-1");
  });

  it("still opens for the signed-in owner", async () => {
    auth.getCurrentUser.mockResolvedValue({ id: "u-owner" });
    const { status, body } = await fetchBooking({});
    expect(status).toBe(200);
    expect(body.bookingId).toBe("UPNV-1");
  });

  it("answers 404 to a wrong session id, never confirming the reference exists", async () => {
    const { status } = await fetchBooking({ session: "sess-guessed" });
    expect(status).toBe(404);
  });

  it("asks a proofless visitor to sign in: 401", async () => {
    const { status } = await fetchBooking({});
    expect(status).toBe(401);
    expect(folio.getFolioForReservation).not.toHaveBeenCalled();
  });
});
