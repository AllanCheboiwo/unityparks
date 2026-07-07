import { describe, expect, it } from "vitest";
import {
  computeTotal,
  isTurnoverDay,
  nightsBetween,
  validateStay,
} from "./rules";

// July 2026: 10th = Friday, 13th = Monday, 14th = Tuesday.
describe("isTurnoverDay", () => {
  it("accepts Fridays and Mondays", () => {
    expect(isTurnoverDay("2026-07-10")).toBe(true); // Friday
    expect(isTurnoverDay("2026-07-13")).toBe(true); // Monday
  });

  it("rejects every other weekday", () => {
    expect(isTurnoverDay("2026-07-11")).toBe(false); // Saturday
    expect(isTurnoverDay("2026-07-12")).toBe(false); // Sunday
    expect(isTurnoverDay("2026-07-14")).toBe(false); // Tuesday
    expect(isTurnoverDay("2026-07-15")).toBe(false); // Wednesday
    expect(isTurnoverDay("2026-07-16")).toBe(false); // Thursday
  });

  it("rejects garbage input", () => {
    expect(isTurnoverDay("not-a-date")).toBe(false);
    expect(isTurnoverDay("")).toBe(false);
  });
});

describe("validateStay", () => {
  it("accepts the three canonical breaks", () => {
    expect(validateStay("2026-07-10", "2026-07-13")).toEqual({ ok: true, nights: 3 }); // Fri->Mon
    expect(validateStay("2026-07-13", "2026-07-17")).toEqual({ ok: true, nights: 4 }); // Mon->Fri
    expect(validateStay("2026-07-10", "2026-07-17")).toEqual({ ok: true, nights: 7 }); // Fri->Fri
  });

  it("accepts multi-week stays anchored on turnover days", () => {
    expect(validateStay("2026-07-10", "2026-07-24")).toEqual({ ok: true, nights: 14 });
  });

  it("refuses a Tuesday arrival with a helpful message", () => {
    const result = validateStay("2026-07-14", "2026-07-17");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Tuesday");
  });

  it("refuses a Saturday departure", () => {
    const result = validateStay("2026-07-10", "2026-07-11");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Saturday");
  });

  it("refuses departure before arrival and bad dates", () => {
    expect(validateStay("2026-07-13", "2026-07-10").ok).toBe(false);
    expect(validateStay("2026-07-10", "2026-07-10").ok).toBe(false);
    expect(validateStay("nope", "2026-07-13").ok).toBe(false);
  });
});

describe("nightsBetween", () => {
  it("counts nights, not days", () => {
    expect(nightsBetween("2026-07-10", "2026-07-13")).toBe(3);
    expect(nightsBetween("2026-07-10", "2026-07-17")).toBe(7);
  });
});

describe("computeTotal", () => {
  it("sums the stay and extras snapshots", () => {
    expect(computeTotal(84000, [{ grossAmount: 4500 }, { grossAmount: 3500 }])).toBe(92000);
    expect(computeTotal(84000, [])).toBe(84000);
  });
});
