import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Frozen suite for UNP-46 (docs/scheduling-plan.md), UNP-41: the Zoho
 * drain must open for a scheduler presenting ZOHO_RUN_SECRET and for a
 * signed-in admin, and for nobody else. The drain itself is a fake that
 * reports a summary; the door is what is under test.
 */

const auth = vi.hoisted(() => ({
  requireAdmin: vi.fn(async (): Promise<unknown> => {
    throw new Error("replaced in beforeEach");
  }),
}));

const drain = vi.hoisted(() => ({
  runZohoExports: vi.fn(async () => ({ done: 2, errored: 0 })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => auth);
vi.mock("@/server/zoho/wire", () => drain);

import { PublicError } from "@/server/api-helpers";
import { POST } from "./route";

function request(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return { headers } as unknown as NextRequest;
}

const ORIGINAL = process.env.ZOHO_RUN_SECRET;

beforeEach(() => {
  auth.requireAdmin.mockClear();
  drain.runZohoExports.mockClear();
  auth.requireAdmin.mockImplementation(async () => {
    throw new PublicError(401, "Please sign in.");
  });
  process.env.ZOHO_RUN_SECRET = "scheduler-secret";
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ZOHO_RUN_SECRET;
  else process.env.ZOHO_RUN_SECRET = ORIGINAL;
});

describe("POST /api/ops/zoho/run", () => {
  it("opens for the scheduler bearer with no session at all", async () => {
    const res = await POST(request("Bearer scheduler-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: 2, errored: 0 });
  });

  it("a wrong bearer falls through to the admin gate and is refused", async () => {
    const res = await POST(request("Bearer nope"));
    expect(res.status).toBe(401);
    expect(drain.runZohoExports).not.toHaveBeenCalled();
  });

  it("with no secret configured, a bearer opens nothing", async () => {
    delete process.env.ZOHO_RUN_SECRET;
    const res = await POST(request("Bearer scheduler-secret"));
    expect(res.status).toBe(401);
    expect(drain.runZohoExports).not.toHaveBeenCalled();
  });

  it("an admin session still opens the drain, as the ops button relies on", async () => {
    auth.requireAdmin.mockResolvedValue({ id: "u-admin", isAdmin: true });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(drain.runZohoExports).toHaveBeenCalledTimes(1);
  });
});
