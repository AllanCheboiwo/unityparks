import { describe, expect, it } from "vitest";
import { adultAtArrival, isUsablePhone } from "./guestRules";

describe("adultAtArrival", () => {
  it("is true on the exact 18th birthday", () => {
    expect(adultAtArrival("2008-09-04", "2026-09-04")).toBe(true);
  });

  it("is false the day before the 18th birthday", () => {
    expect(adultAtArrival("2008-09-05", "2026-09-04")).toBe(false);
  });

  it("is true for a comfortable adult", () => {
    expect(adultAtArrival("1990-01-01", "2026-09-04")).toBe(true);
  });

  it("handles a 29 February birthday against a non-leap arrival", () => {
    // The cutoff is the literal string 2008-02-29, which does not exist as a
    // date; string comparison still orders it correctly between the 28th and
    // the 1st, which is all the rule needs.
    expect(adultAtArrival("2008-02-28", "2026-02-28")).toBe(true);
    expect(adultAtArrival("2008-03-01", "2026-02-28")).toBe(false);
  });

  it("refuses a blank or malformed date of birth", () => {
    expect(adultAtArrival("", "2026-09-04")).toBe(false);
    expect(adultAtArrival("1990-1-1", "2026-09-04")).toBe(false);
  });
});

describe("isUsablePhone", () => {
  it("counts digits, not punctuation", () => {
    expect(isUsablePhone("717 464 236")).toBe(true);
    expect(isUsablePhone("717-464")).toBe(false);
  });

  it("refuses blank", () => {
    expect(isUsablePhone("")).toBe(false);
  });
});
