import { describe, expect, it } from "vitest";
import {
  balanceDueDateFor,
  computeRefund,
  daysBetween,
  depositAmountFor,
  isDepositEligible,
  isValidPartPayment,
  refundPercentFor,
  reminderStageFor,
} from "./paymentPlan";

describe("depositAmountFor", () => {
  it("takes 30% in whole KES", () => {
    expect(depositAmountFor(100_000)).toBe(30_000);
    expect(depositAmountFor(84_000)).toBe(25_200);
  });

  it("rounds instead of truncating", () => {
    expect(depositAmountFor(99_999)).toBe(30_000); // 29999.7 rounds up
  });
});

describe("balanceDueDateFor", () => {
  it("is arrival minus 56 days", () => {
    expect(balanceDueDateFor("2026-10-30")).toBe("2026-09-04");
    expect(balanceDueDateFor("2026-09-18")).toBe("2026-07-24");
  });

  it("crosses year boundaries", () => {
    expect(balanceDueDateFor("2027-01-15")).toBe("2026-11-20");
  });
});

describe("daysBetween", () => {
  it("counts whole days, signed", () => {
    expect(daysBetween("2026-07-23", "2026-09-18")).toBe(57);
    expect(daysBetween("2026-07-23", "2026-07-23")).toBe(0);
    expect(daysBetween("2026-07-23", "2026-07-22")).toBe(-1);
  });
});

describe("isDepositEligible", () => {
  it("draws the line between 56 and 57 days", () => {
    expect(isDepositEligible(57)).toBe(true);
    expect(isDepositEligible(56)).toBe(false);
  });
});

describe("refundPercentFor", () => {
  it("steps down at exactly the tier boundaries", () => {
    expect(refundPercentFor(57)).toBe(100);
    expect(refundPercentFor(56)).toBe(50);
    expect(refundPercentFor(42)).toBe(50);
    expect(refundPercentFor(41)).toBe(25);
    expect(refundPercentFor(21)).toBe(25);
    expect(refundPercentFor(20)).toBe(0);
    expect(refundPercentFor(1)).toBe(0);
  });
});

describe("computeRefund", () => {
  it("never refunds the deposit, at any tier", () => {
    for (const daysToArrival of [90, 50, 30, 10]) {
      const result = computeRefund({
        total: 100_000,
        paidAmount: 30_000, // deposit only
        depositAmount: 30_000,
        daysToArrival,
      });
      expect(result.refundAmount).toBe(0);
      expect(result.depositKept).toBe(30_000);
      expect(result.keptAmount).toBe(30_000);
    }
  });

  it("refunds everything except the deposit above 56 days", () => {
    const result = computeRefund({
      total: 100_000,
      paidAmount: 100_000,
      depositAmount: 30_000,
      daysToArrival: 60,
    });
    expect(result.refundAmount).toBe(70_000);
    expect(result.keptAmount).toBe(30_000);
  });

  it("applies the tier percentage to the balance beyond the deposit", () => {
    const halved = computeRefund({
      total: 100_000,
      paidAmount: 80_000, // deposit plus a 50k part payment
      depositAmount: 30_000,
      daysToArrival: 50,
    });
    expect(halved.refundPercent).toBe(50);
    expect(halved.refundAmount).toBe(25_000);
    expect(halved.keptAmount).toBe(55_000);
  });

  it("derives the 30% deposit for legacy records without one stored", () => {
    const result = computeRefund({
      total: 100_000,
      paidAmount: 100_000,
      depositAmount: null,
      daysToArrival: 60,
    });
    expect(result.depositKept).toBe(30_000);
    expect(result.refundAmount).toBe(70_000);
  });
});

describe("isValidPartPayment", () => {
  it("always allows clearing the balance exactly", () => {
    expect(isValidPartPayment(1_000, 1_000)).toBe(true);
    expect(isValidPartPayment(70_000, 70_000)).toBe(true);
    expect(isValidPartPayment(499, 499)).toBe(true); // small tail is payable
  });

  it("enforces the minimum on the payment itself", () => {
    expect(isValidPartPayment(499, 10_000)).toBe(false);
    expect(isValidPartPayment(500, 10_000)).toBe(true);
  });

  it("refuses to strand a remainder under the minimum", () => {
    expect(isValidPartPayment(700, 1_000)).toBe(false); // leaves 300
    expect(isValidPartPayment(500, 1_000)).toBe(true); // leaves exactly 500
  });

  it("refuses overpayment, non-integers and nonsense", () => {
    expect(isValidPartPayment(1_200, 1_000)).toBe(false);
    expect(isValidPartPayment(500.5, 10_000)).toBe(false);
    expect(isValidPartPayment(0, 10_000)).toBe(false);
    expect(isValidPartPayment(-500, 10_000)).toBe(false);
    expect(isValidPartPayment(500, 0)).toBe(false);
  });
});

describe("reminderStageFor", () => {
  it("is quiet while the due date is more than 14 days away", () => {
    expect(reminderStageFor("2026-08-01", "2026-08-16")).toBe(null);
    expect(reminderStageFor("2026-08-01", "2026-12-01")).toBe(null);
  });

  it("says upcoming through the 14-day window, due date included", () => {
    expect(reminderStageFor("2026-08-01", "2026-08-15")).toBe("upcoming");
    expect(reminderStageFor("2026-08-14", "2026-08-15")).toBe("upcoming");
    expect(reminderStageFor("2026-08-15", "2026-08-15")).toBe("upcoming");
  });

  it("says overdue the day after the due date and forever on", () => {
    expect(reminderStageFor("2026-08-16", "2026-08-15")).toBe("overdue");
    expect(reminderStageFor("2027-01-01", "2026-08-15")).toBe("overdue");
  });

  it("handles month and year boundaries like daysBetween does", () => {
    expect(reminderStageFor("2026-12-28", "2027-01-04")).toBe("upcoming");
  });
});

describe("computeRefund after post-booking extras", () => {
  // The legacy sentinel (paidAmount 0 on a fully paid pre-deposit record)
  // must be lifted to the truth before extras grow it, or the refund
  // collapses. This pins the arithmetic the extras settle relies on.
  it("still refunds the balance beyond the deposit once extras were added", () => {
    const originalTotal = 100_000;
    const extra = 3_000;
    const result = computeRefund({
      total: originalTotal + extra,
      // What settleExtrasOrder writes for a legacy paid record: the whole
      // original total, plus the extra it just charged.
      paidAmount: originalTotal + extra,
      depositAmount: null, // legacy record, deposit derived as 30% of total
      daysToArrival: 60,
    });
    expect(result.refundPercent).toBe(100);
    expect(result.depositKept).toBe(30_900); // 30% of the grown total
    expect(result.refundAmount).toBe(72_100);
  });

  it("would have refunded nothing if the sentinel had been incremented", () => {
    // The bug this guards against: paidAmount 0 + 3000 = 3000, so the
    // deposit swallows everything and the guest gets nothing back.
    const collapsed = computeRefund({
      total: 103_000,
      paidAmount: 3_000,
      depositAmount: null,
      daysToArrival: 60,
    });
    expect(collapsed.refundAmount).toBe(0);
  });
});
