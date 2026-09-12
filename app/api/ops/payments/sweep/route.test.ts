import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Frozen suite for UNP-46 (docs/scheduling-plan.md), UNP-40: the payment
 * sweep route opens for a scheduler presenting PAYMENTS_RUN_SECRET and for
 * a signed-in admin, and for nobody else. The sweep itself is a fake that
 * reports a summary; the door is what is under test.
 */

const auth = vi.hoisted(() => ({
  requireAdmin: vi.fn(async (): Promise<unknown> => {
    throw new Error("replaced in beforeEach");
  }),
}));

const SUMMARY = {
  checked: 1,
  settled: 1,
  retired: 0,
  stillPending: 0,
  unlinked: 0,
  extrasRecovered: 0,
  errored: 0,
};

const sweep = vi.hoisted(() => ({
  runPaymentSweep: vi.fn(async () => ({
    checked: 1,
    settled: 1,
    retired: 0,
    stillPending: 0,
    unlinked: 0,
    extrasRecovered: 0,
    errored: 0,
  })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => auth);
vi.mock("@/server/booking/sweepWire", () => sweep);

import { PublicError } from "@/server/api-helpers";
import { POST } from "./route";

function request(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return { headers } as unknown as NextRequest;
}

const ORIGINAL = process.env.PAYMENTS_RUN_SECRET;

beforeEach(() => {
  auth.requireAdmin.mockClear();
  sweep.runPaymentSweep.mockClear();
  auth.requireAdmin.mockImplementation(async () => {
    throw new PublicError(401, "Please sign in.");
  });
  process.env.PAYMENTS_RUN_SECRET = "scheduler-secret";
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PAYMENTS_RUN_SECRET;
  else process.env.PAYMENTS_RUN_SECRET = ORIGINAL;
});

describe("POST /api/ops/payments/sweep", () => {
  it("opens for the scheduler bearer with no session at all and returns the summary", async () => {
    const res = await POST(request("Bearer scheduler-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUMMARY);
  });

  it("a wrong bearer falls through to the admin gate and is refused", async () => {
    const res = await POST(request("Bearer nope"));
    expect(res.status).toBe(401);
    expect(sweep.runPaymentSweep).not.toHaveBeenCalled();
  });

  it("with no secret configured, a bearer opens nothing", async () => {
    delete process.env.PAYMENTS_RUN_SECRET;
    const res = await POST(request("Bearer scheduler-secret"));
    expect(res.status).toBe(401);
    expect(sweep.runPaymentSweep).not.toHaveBeenCalled();
  });

  it("an admin session opens the sweep", async () => {
    auth.requireAdmin.mockResolvedValue({ id: "u-admin", isAdmin: true });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(sweep.runPaymentSweep).toHaveBeenCalledTimes(1);
  });
});
