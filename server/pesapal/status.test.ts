import { describe, expect, it } from "vitest";
import { outcomeFromStatusCode, paymentMatchesOrder } from "./status";

describe("outcomeFromStatusCode", () => {
  it("maps Pesapal's four documented codes", () => {
    expect(outcomeFromStatusCode(0)).toBe("pending"); // INVALID = nothing happened yet
    expect(outcomeFromStatusCode(1)).toBe("completed");
    expect(outcomeFromStatusCode(2)).toBe("failed");
    expect(outcomeFromStatusCode(3)).toBe("reversed");
  });

  it("never settles on anything it does not recognise", () => {
    expect(outcomeFromStatusCode(undefined)).toBe("pending");
    expect(outcomeFromStatusCode(4)).toBe("pending");
    expect(outcomeFromStatusCode(-1)).toBe("pending");
  });
});

describe("paymentMatchesOrder", () => {
  const order = { amount: 128_500, currency: "KES" };

  it("accepts Pesapal's echo of what we asked for", () => {
    expect(paymentMatchesOrder(order, { amount: 128_500, currency: "KES" })).toBe(true);
  });

  it("tolerates float noise below a cent", () => {
    expect(paymentMatchesOrder(order, { amount: 128_500.001, currency: "KES" })).toBe(true);
  });

  it("rejects a different amount", () => {
    expect(paymentMatchesOrder(order, { amount: 128_499, currency: "KES" })).toBe(false);
    expect(paymentMatchesOrder(order, { amount: 0, currency: "KES" })).toBe(false);
  });

  it("rejects a different or missing currency", () => {
    expect(paymentMatchesOrder(order, { amount: 128_500, currency: "USD" })).toBe(false);
    expect(paymentMatchesOrder(order, { amount: 128_500, currency: null })).toBe(false);
  });
});
