import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UNP-33 (docs/observability-plan.md): the error reporter. Guarantees:
 * every call reaches both the console and Sentry, the ids given arrive as
 * searchable tags, and a thrown non-Error still arrives as an Error so it
 * carries a stack. Sentry is the boundary, so its capture call is the
 * observable outcome here.
 */

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

import { logError } from "./log";

beforeEach(() => {
  sentry.captureException.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("logError", () => {
  it("reports the error to Sentry with the ids as tags", () => {
    const err = new Error("boom");
    logError("Pesapal IPN failed", err, { bookingId: "rec-1", route: "pesapal/ipn" });
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [sent, ctx] = sentry.captureException.mock.calls[0];
    expect(sent).toBe(err);
    expect(ctx.tags).toMatchObject({ bookingId: "rec-1", route: "pesapal/ipn" });
  });

  it("still writes to the console so Railway logs keep the message", () => {
    logError("Amend failed", new Error("x"), { bookingId: "rec-2" });
    expect(console.error).toHaveBeenCalledTimes(1);
    const line = (console.error as ReturnType<typeof vi.fn>).mock.calls[0].map(String).join(" ");
    expect(line).toContain("Amend failed");
  });

  it("wraps a thrown non-Error so Sentry receives something with a stack", () => {
    logError("odd throw", "just a string");
    const [sent] = sentry.captureException.mock.calls[0];
    expect(sent).toBeInstanceOf(Error);
    expect(sent.message).toContain("just a string");
  });

  it("omits empty ids rather than tagging them as null or undefined", () => {
    logError("no ids", new Error("x"), { bookingId: null, userId: undefined });
    const [, ctx] = sentry.captureException.mock.calls[0];
    expect(ctx.tags).toEqual({});
  });
});
