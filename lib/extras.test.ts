import { describe, expect, it } from "vitest";
import {
  extraUnitPrice,
  isQuantityExtra,
  MAX_EXTRA_QTY,
  mergeExtras,
  priceAdditions,
  type ExtraLine,
} from "./extras";

const CYCLE = {
  serviceId: "UPNV-CYCLE",
  code: "CYCLE",
  name: "Cycle hire",
  pricingUnit: "Person",
  count: 2,
  totalGrossAmount: 4800,
};
const SPA = {
  serviceId: "UPNV-SPA",
  code: "SPA",
  name: "Spa pass",
  pricingUnit: "Person",
  count: 2,
  totalGrossAmount: 9000,
};
const EARLY = {
  serviceId: "UPNV-EARLY",
  code: "EARLY",
  name: "Early check-in",
  pricingUnit: "Room",
  count: 1,
  totalGrossAmount: 4500,
};
const OFFERS = [CYCLE, SPA, EARLY];

describe("extraUnitPrice", () => {
  it("divides the default-count total by the count", () => {
    expect(extraUnitPrice(CYCLE)).toBe(2400);
    expect(extraUnitPrice(EARLY)).toBe(4500);
  });

  it("never divides by zero", () => {
    expect(extraUnitPrice({ totalGrossAmount: 4500, count: 0 })).toBe(4500);
  });
});

describe("isQuantityExtra", () => {
  it("treats Person pricing as quantity and Room pricing as one-off", () => {
    expect(isQuantityExtra({ pricingUnit: "Person" })).toBe(true);
    expect(isQuantityExtra({ pricingUnit: "PersonPerNight" })).toBe(true);
    expect(isQuantityExtra({ pricingUnit: "Room" })).toBe(false);
    expect(isQuantityExtra({ pricingUnit: "RoomPerNight" })).toBe(false);
  });
});

describe("priceAdditions", () => {
  it("prices a quantity addition at unit price times the added count", () => {
    const result = priceAdditions(OFFERS, [], [{ serviceId: "UPNV-CYCLE", count: 3 }]);
    expect(result).toMatchObject({ ok: true, total: 7200 });
    if (result.ok) {
      expect(result.additions[0]).toMatchObject({
        previousCount: 0,
        addCount: 3,
        targetCount: 3,
        amount: 7200,
      });
    }
  });

  it("targets previous plus added for a service already on the lodge", () => {
    const result = priceAdditions(
      OFFERS,
      [{ serviceId: "UPNV-CYCLE", count: 2 }],
      [{ serviceId: "UPNV-CYCLE", count: 2 }],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // book-service SETS the count, so the target is the absolute 4.
      expect(result.additions[0]).toMatchObject({
        previousCount: 2,
        targetCount: 4,
        amount: 4800,
      });
    }
  });

  it("sums several services into one total", () => {
    const result = priceAdditions(OFFERS, [], [
      { serviceId: "UPNV-CYCLE", count: 1 },
      { serviceId: "UPNV-EARLY", count: 1 },
    ]);
    expect(result).toMatchObject({ ok: true, total: 2400 + 4500 });
  });

  it("refuses an empty request", () => {
    expect(priceAdditions(OFFERS, [], []).ok).toBe(false);
  });

  it("refuses duplicate services in one request", () => {
    const result = priceAdditions(OFFERS, [], [
      { serviceId: "UPNV-CYCLE", count: 1 },
      { serviceId: "UPNV-CYCLE", count: 1 },
    ]);
    expect(result.ok).toBe(false);
  });

  it("refuses non-integer and non-positive counts", () => {
    expect(priceAdditions(OFFERS, [], [{ serviceId: "UPNV-CYCLE", count: 1.5 }]).ok).toBe(false);
    expect(priceAdditions(OFFERS, [], [{ serviceId: "UPNV-CYCLE", count: 0 }]).ok).toBe(false);
    expect(priceAdditions(OFFERS, [], [{ serviceId: "UPNV-CYCLE", count: -2 }]).ok).toBe(false);
  });

  it("refuses services that aren't offered", () => {
    expect(priceAdditions(OFFERS, [], [{ serviceId: "UPNV-DOG", count: 1 }]).ok).toBe(false);
  });

  it("caps quantity items at the checkout maximum across owned plus added", () => {
    const ok = priceAdditions(
      OFFERS,
      [{ serviceId: "UPNV-SPA", count: 6 }],
      [{ serviceId: "UPNV-SPA", count: 2 }],
    );
    expect(ok.ok).toBe(true);
    const over = priceAdditions(
      OFFERS,
      [{ serviceId: "UPNV-SPA", count: 6 }],
      [{ serviceId: "UPNV-SPA", count: MAX_EXTRA_QTY - 6 + 1 }],
    );
    expect(over.ok).toBe(false);
  });

  it("refuses a one-off that is already on the lodge", () => {
    const result = priceAdditions(
      OFFERS,
      [{ serviceId: "UPNV-EARLY", count: 1 }],
      [{ serviceId: "UPNV-EARLY", count: 1 }],
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a one-off with a count above one", () => {
    expect(priceAdditions(OFFERS, [], [{ serviceId: "UPNV-EARLY", count: 2 }]).ok).toBe(false);
  });
});

describe("mergeExtras", () => {
  const existing: ExtraLine[] = [
    { serviceId: "UPNV-CYCLE", code: "CYCLE", name: "Cycle hire", count: 2, grossAmount: 4800 },
  ];

  it("grows an existing line and appends new ones", () => {
    const priced = priceAdditions(
      OFFERS,
      [{ serviceId: "UPNV-CYCLE", count: 2 }],
      [
        { serviceId: "UPNV-CYCLE", count: 1 },
        { serviceId: "UPNV-EARLY", count: 1 },
      ],
    );
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;
    const merged = mergeExtras(existing, priced.additions);
    expect(merged).toEqual([
      { serviceId: "UPNV-CYCLE", code: "CYCLE", name: "Cycle hire", count: 3, grossAmount: 7200 },
      { serviceId: "UPNV-EARLY", code: "EARLY", name: "Early check-in", count: 1, grossAmount: 4500 },
    ]);
  });

  it("never mutates its inputs", () => {
    const priced = priceAdditions(
      OFFERS,
      [{ serviceId: "UPNV-CYCLE", count: 2 }],
      [{ serviceId: "UPNV-CYCLE", count: 1 }],
    );
    if (!priced.ok) throw new Error("expected ok");
    mergeExtras(existing, priced.additions);
    expect(existing[0].count).toBe(2);
    expect(existing[0].grossAmount).toBe(4800);
  });
});
