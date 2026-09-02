import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { planInstrumentAllowances } from "./instrument";

/**
 * Frozen suite for UNP-7 (docs/promo-codes-plan.md, section 6): the shared
 * discount-instrument seam extracted from the referral checkout.
 *
 * The planner answers, deterministically, which folio gets which allowance
 * under which idempotency key. Determinism IS the crash-replay guarantee:
 * a replayed checkout must produce byte-identical posts so Apaleo's 24h
 * dedup window can absorb them. The actual posting, and the referral
 * crash-replay re-proof on the extracted seam, are executor and acceptance
 * work, not unit tests.
 */

const folios = [
  { folioId: "folio-a", currency: "KES" },
  { folioId: "folio-b", currency: "KES" },
];

function plan(overrides: Record<string, unknown> = {}) {
  return planInstrumentAllowances({
    instrument: "repeat",
    sessionId: "sess-1",
    amount: 10_000,
    bases: [60_000, 40_000],
    folios,
    reasonRef: "rec-earn",
    ...overrides,
  });
}

describe("planInstrumentAllowances", () => {
  it("splits pro-rata across lodges and the shares sum to the amount", () => {
    const posts = plan();
    expect(posts.map((p) => p.amount)).toEqual([6000, 4000]);
    expect(posts.map((p) => p.folioId)).toEqual(["folio-a", "folio-b"]);
    expect(posts.every((p) => p.currency === "KES")).toBe(true);
  });

  it("is deterministic: a replay produces byte-identical posts, keys included", () => {
    expect(plan()).toEqual(plan());
  });

  it("gives every slot its own idempotency key", () => {
    const posts = plan();
    expect(new Set(posts.map((p) => p.idempotencyKey)).size).toBe(posts.length);
  });

  it("gives every session its own keys: two bookings never dedupe into each other", () => {
    const a = plan({ sessionId: "sess-1" });
    const b = plan({ sessionId: "sess-2" });
    expect(a.map((p) => p.idempotencyKey)).not.toEqual(b.map((p) => p.idempotencyKey));
  });

  it("gives every instrument its own keys: a repeat allowance can never be swallowed by a referral one posted in the same dedup window", () => {
    const repeat = plan({ instrument: "repeat" });
    const referral = plan({ instrument: "referral" });
    for (const key of repeat.map((p) => p.idempotencyKey)) {
      expect(referral.map((p) => p.idempotencyKey)).not.toContain(key);
    }
  });

  it("an awkward split loses no shilling: pro-rata rounding, last lodge takes the remainder", () => {
    const posts = plan({
      amount: 5000,
      bases: [30_000, 30_000, 30_000],
      folios: [
        { folioId: "folio-a", currency: "KES" },
        { folioId: "folio-b", currency: "KES" },
        { folioId: "folio-c", currency: "KES" },
      ],
    });
    expect(posts.map((p) => p.amount)).toEqual([1667, 1667, 1666]);
    expect(posts.reduce((sum, p) => sum + p.amount, 0)).toBe(5000);
  });

  it("skips folios whose share rounds to zero rather than posting a zero allowance", () => {
    const posts = plan({ amount: 5000, bases: [96_000, 0] });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ folioId: "folio-a", amount: 5000 });
  });

  it("never pushes a share above its base, carrying overflow to the next lodge", () => {
    // A folio allowance above the folio's own charges would be refused or
    // leave a credit; the split must clamp, exactly as the referral seam does.
    const posts = plan({ amount: 5900, bases: [5000, 1000] });
    expect(posts[0].amount).toBeLessThanOrEqual(5000);
    expect(posts[1].amount).toBeLessThanOrEqual(1000);
    expect(posts.reduce((sum, p) => sum + p.amount, 0)).toBe(5900);
  });

  it("refuses an amount above the sum of bases rather than posting nonsense", () => {
    expect(() => plan({ amount: 7000, bases: [5000, 1000] })).toThrow();
  });

  it("stamps the reason with the earning reference so every allowance is attributable in Apaleo", () => {
    for (const post of plan()) {
      expect(post.reason).toContain("rec-earn");
    }
  });
});
