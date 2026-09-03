import { describe, expect, it } from "vitest";
import {
  OFFER_LODGE_CAP,
  OFFER_PER_LODGE,
  OFFER_WINDOW_DAYS,
  capOfferDiscount,
  isOfferWindowOpen,
  offerDeadline,
  offerDiscountFor,
} from "./repeatOffer";
import { MIN_PART_PAYMENT } from "./paymentPlan";
import { capApplicableCredit } from "./referral";

/**
 * Frozen suite for UNP-7 (docs/promo-codes-plan.md): the pure offer math.
 *
 * Value, lodge cap and window are constants here until a second offer type
 * exists (spec section 7). The window rules mirror the referral vesting
 * discipline: a stay counts only strictly after its departure day, and the
 * last valid booking day is departure plus OFFER_WINDOW_DAYS inclusive.
 */

describe("constants", () => {
  it("KSh 5,000 per lodge, capped at 3 lodges, 31-day window (spec decisions 2 and 3)", () => {
    expect(OFFER_PER_LODGE).toBe(5000);
    expect(OFFER_LODGE_CAP).toBe(3);
    expect(OFFER_WINDOW_DAYS).toBe(31);
  });
});

describe("offerDiscountFor", () => {
  it("pays per lodge of the NEW booking up to the cap: 5,000 to 15,000", () => {
    expect(offerDiscountFor(1)).toBe(5000);
    expect(offerDiscountFor(2)).toBe(10_000);
    expect(offerDiscountFor(3)).toBe(15_000);
  });

  it("a fourth lodge earns nothing more", () => {
    expect(offerDiscountFor(4)).toBe(15_000);
    expect(offerDiscountFor(10)).toBe(15_000);
  });

  it("no lodges, no discount", () => {
    expect(offerDiscountFor(0)).toBe(0);
  });
});

describe("isOfferWindowOpen", () => {
  const departure = "2026-09-01";

  it("closed on the departure day itself: the stay has not departed yet", () => {
    expect(isOfferWindowOpen({ departure, todayIso: "2026-09-01" })).toBe(false);
  });

  it("open the day after departure", () => {
    expect(isOfferWindowOpen({ departure, todayIso: "2026-09-02" })).toBe(true);
  });

  it("open on exactly day 31, the last valid day", () => {
    expect(isOfferWindowOpen({ departure, todayIso: "2026-10-02" })).toBe(true);
  });

  it("closed on day 32", () => {
    expect(isOfferWindowOpen({ departure, todayIso: "2026-10-03" })).toBe(false);
  });

  it("closed before the stay ever happens", () => {
    expect(isOfferWindowOpen({ departure, todayIso: "2026-08-15" })).toBe(false);
  });
});

describe("offerDeadline", () => {
  it("is departure plus 31 days, the same day isOfferWindowOpen last accepts", () => {
    const departure = "2026-09-01";
    const deadline = offerDeadline(departure);
    expect(deadline).toBe("2026-10-02");
    expect(isOfferWindowOpen({ departure, todayIso: deadline })).toBe(true);
  });

  it("crosses month and year ends correctly", () => {
    expect(offerDeadline("2026-12-15")).toBe("2027-01-15");
  });
});

describe("capOfferDiscount", () => {
  it("leaves the full discount when the booking has room", () => {
    expect(capOfferDiscount({ bookingTotal: 96_000, discount: 5000 })).toBe(5000);
  });

  it("caps so at least KSh 500 stays collectable (invariant 4)", () => {
    expect(
      capOfferDiscount({ bookingTotal: 5000 + MIN_PART_PAYMENT - 100, discount: 5000 }),
    ).toBe(4900);
  });

  it("never goes negative on a booking cheaper than the floor", () => {
    expect(capOfferDiscount({ bookingTotal: 400, discount: 5000 })).toBe(0);
  });

  it("composes with referral credit: one shared 500 floor arbitrates the pair (invariant 4, decision 7)", () => {
    // Credit is capped against what the offer discount leaves, so the two
    // instruments together can never eat past the floor. Capping each
    // independently against the full total would leave zero collectable.
    const bookingTotal = 10_000;
    const discount = capOfferDiscount({ bookingTotal, discount: 5000 });
    const credit = capApplicableCredit({ bookingTotal, discount, vestedBalance: 5000 });
    expect(discount).toBe(5000);
    expect(credit).toBe(4500);
    expect(bookingTotal - discount - credit).toBe(MIN_PART_PAYMENT);
  });
});
