import { describe, expect, it } from "vitest";
import {
  capApplicableCredit,
  commissionAmountFor,
  commissionBaseFor,
  configInForce,
  isCommissionEarnPayable,
  isCreditEarnVested,
  isSpendActive,
  isValidCodeFormat,
  matchesPriorContact,
  normalizeReferralCode,
  phonesMatch,
  splitAcrossLodges,
} from "./referral";

describe("normalizeReferralCode / isValidCodeFormat", () => {
  it("uppercases and trims", () => {
    expect(normalizeReferralCode("  amina ")).toBe("AMINA");
  });

  it("accepts generated and vanity shapes, rejects junk", () => {
    expect(isValidCodeFormat("AMINA")).toBe(true);
    expect(isValidCodeFormat("K7MX2P")).toBe(true);
    expect(isValidCodeFormat("AB")).toBe(false); // too short
    expect(isValidCodeFormat("ABCDEFGHIJKLM")).toBe(false); // too long
    expect(isValidCodeFormat("AM INA")).toBe(false);
    expect(isValidCodeFormat("amina")).toBe(false); // callers normalize first
  });
});

describe("splitAcrossLodges", () => {
  it("puts everything on a single lodge", () => {
    expect(splitAcrossLodges(5000, [96_000])).toEqual([5000]);
  });

  it("splits pro-rata with last-takes-remainder", () => {
    // 5000 over 60k/40k: 3000 + remainder 2000
    expect(splitAcrossLodges(5000, [60_000, 40_000])).toEqual([3000, 2000]);
    // A split that rounds: 5000 over three equal lodges
    const shares = splitAcrossLodges(5000, [30_000, 30_000, 30_000]);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(5000);
    expect(shares).toEqual([1667, 1667, 1666]);
  });

  it("is deterministic across calls (crash-replay stability)", () => {
    const a = splitAcrossLodges(7777, [55_000, 21_000, 34_000]);
    const b = splitAcrossLodges(7777, [55_000, 21_000, 34_000]);
    expect(a).toEqual(b);
    expect(a.reduce((s, x) => s + x, 0)).toBe(7777);
  });

  it("never pushes a share above its base, carrying overflow", () => {
    // Tiny lodge: its rounded share would fit, but force clamping via a
    // total close to the sum of bases.
    const shares = splitAcrossLodges(5900, [5000, 1000]);
    expect(shares[0]).toBeLessThanOrEqual(5000);
    expect(shares[1]).toBeLessThanOrEqual(1000);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(5900);
  });

  it("refuses a total above the bases", () => {
    expect(() => splitAcrossLodges(7000, [5000, 1000])).toThrow();
  });

  it("zero total means zero shares", () => {
    expect(splitAcrossLodges(0, [50_000, 30_000])).toEqual([0, 0]);
  });
});

describe("capApplicableCredit", () => {
  it("caps so 500 stays collectable after the discount", () => {
    expect(
      capApplicableCredit({ bookingTotal: 10_000, discount: 5000, vestedBalance: 5000 }),
    ).toBe(4500);
  });

  it("returns the full balance when the booking has room", () => {
    expect(
      capApplicableCredit({ bookingTotal: 96_000, discount: 5000, vestedBalance: 5000 }),
    ).toBe(5000);
  });

  it("never goes negative on a cheap booking", () => {
    expect(
      capApplicableCredit({ bookingTotal: 5200, discount: 5000, vestedBalance: 5000 }),
    ).toBe(0);
  });
});

describe("configInForce", () => {
  const configs = [
    { id: "a", effectiveFrom: "2026-01-01", guestDiscount: 5000, clientCredit: 5000, defaultCommissionRate: 0.04, creditExpiryDays: 365 },
    { id: "b", effectiveFrom: "2026-09-01", guestDiscount: 7000, clientCredit: 6000, defaultCommissionRate: 0.05, creditExpiryDays: 365 },
  ];

  it("picks the latest row on or before the date", () => {
    expect(configInForce(configs, "2026-08-04")?.id).toBe("a");
    expect(configInForce(configs, "2026-09-01")?.id).toBe("b");
    expect(configInForce(configs, "2027-01-01")?.id).toBe("b");
  });

  it("null before any config exists", () => {
    expect(configInForce(configs, "2025-12-31")).toBeNull();
  });
});

describe("commission base and amount", () => {
  it("is lodging minus discount, floored at zero", () => {
    expect(commissionBaseFor(96_000, 5000)).toBe(91_000);
    expect(commissionBaseFor(4000, 5000)).toBe(0);
  });

  it("rounds the commission to whole KES", () => {
    expect(commissionAmountFor(91_000, 0.04)).toBe(3640);
    expect(commissionAmountFor(91_555, 0.045)).toBe(4120); // 4119.975 rounds
  });
});

describe("isCreditEarnVested", () => {
  const base = {
    attributionState: "earned",
    recordStatus: "paid",
    departure: "2026-08-01",
    creditExpiryDays: 365,
    todayIso: "2026-08-04",
  };

  it("vests after departure on a paid, unvoided booking", () => {
    expect(isCreditEarnVested(base)).toBe(true);
  });

  it("not before departure", () => {
    expect(isCreditEarnVested({ ...base, departure: "2026-08-04" })).toBe(false);
    expect(isCreditEarnVested({ ...base, departure: "2026-09-01" })).toBe(false);
  });

  it("a void attribution or a non-paid record kills it (either alone)", () => {
    expect(isCreditEarnVested({ ...base, attributionState: "void" })).toBe(false);
    expect(isCreditEarnVested({ ...base, recordStatus: "cancelled" })).toBe(false);
    expect(isCreditEarnVested({ ...base, recordStatus: "deposit_paid" })).toBe(false);
  });

  it("expires creditExpiryDays after departure", () => {
    expect(
      isCreditEarnVested({ ...base, departure: "2025-08-01", todayIso: "2026-08-01" }),
    ).toBe(true); // exactly 365 days: last valid day
    expect(
      isCreditEarnVested({ ...base, departure: "2025-08-01", todayIso: "2026-08-02" }),
    ).toBe(false);
  });
});

describe("isCommissionEarnPayable", () => {
  const base = {
    attributionState: "earned",
    recordStatus: "paid",
    departure: "2026-08-01",
    todayIso: "2026-08-04",
  };

  it("payable after departure, and never expires", () => {
    expect(isCommissionEarnPayable(base)).toBe(true);
    expect(isCommissionEarnPayable({ ...base, departure: "2020-01-01" })).toBe(true);
  });

  it("void or unpaid kills it", () => {
    expect(isCommissionEarnPayable({ ...base, attributionState: "void" })).toBe(false);
    expect(isCommissionEarnPayable({ ...base, recordStatus: "cancelled" })).toBe(false);
  });
});

describe("isSpendActive", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const fresh = new Date("2026-08-04T12:20:00Z");
  const stale = new Date("2026-08-04T11:00:00Z");

  it("counts while the booking is alive or resumable", () => {
    expect(isSpendActive({ recordStatus: "paid", sessionExpiresAt: stale, now })).toBe(true);
    expect(isSpendActive({ recordStatus: "deposit_paid", sessionExpiresAt: stale, now })).toBe(true);
    // created is resumable indefinitely: locked until an ops release
    expect(isSpendActive({ recordStatus: "created", sessionExpiresAt: stale, now })).toBe(true);
  });

  it("stops counting when the booking cancelled or failed (this IS the refund)", () => {
    expect(isSpendActive({ recordStatus: "cancelled", sessionExpiresAt: stale, now })).toBe(false);
    expect(isSpendActive({ recordStatus: "failed", sessionExpiresAt: stale, now })).toBe(false);
  });

  it("no record: counts only while the session is fresh", () => {
    expect(isSpendActive({ recordStatus: null, sessionExpiresAt: fresh, now })).toBe(true);
    expect(isSpendActive({ recordStatus: null, sessionExpiresAt: stale, now })).toBe(false);
  });
});

describe("phonesMatch", () => {
  it("matches across formats on the last nine digits", () => {
    expect(phonesMatch("+254 700 123 456", "0700123456")).toBe(true);
    expect(phonesMatch("0700-123-456", "700123456")).toBe(true);
  });

  it("refuses different numbers, short numbers, and blanks", () => {
    expect(phonesMatch("+254700123456", "+254700123457")).toBe(false);
    expect(phonesMatch("12345", "12345")).toBe(false); // under 7 digits
    expect(phonesMatch(null, "0700123456")).toBe(false);
    expect(phonesMatch("0700123456", undefined)).toBe(false);
  });
});

describe("matchesPriorContact", () => {
  const prior = { email: "amina@example.com", phone: "+254 700 123 456" };

  it("matches on email alone", () => {
    expect(matchesPriorContact({ email: "amina@example.com", phone: null }, prior)).toBe(true);
  });

  it("matches on phone alone, across formats", () => {
    expect(matchesPriorContact({ email: "other@example.com", phone: "0700123456" }, prior)).toBe(
      true,
    );
  });

  it("no match when both differ or are missing", () => {
    expect(
      matchesPriorContact({ email: "other@example.com", phone: "0711999888" }, prior),
    ).toBe(false);
    expect(matchesPriorContact({ email: null, phone: null }, prior)).toBe(false);
    expect(matchesPriorContact({ email: "a@b.co", phone: "0700123456" }, { email: null, phone: null })).toBe(false);
  });
});
