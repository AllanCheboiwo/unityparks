import { describe, expect, it } from "vitest";
import {
  capFor,
  classifyCheckoutOffers,
  freeCount,
  freeForStay,
  HOLD_TTL_MINUTES,
  isTeaserSnapshot,
  opensOnDate,
  resourceWindow,
  stayNights,
  validateActivityRequests,
  type ResourceFacts,
} from "./inventory";

/**
 * Frozen suite for UNP-6 (docs/activity-inventory-plan.md): the pure half
 * of the inventory layer. Window math, caps, free-count derivation, the
 * request validator that turns a guest's picks into hold lines, and the
 * checkout classification that keeps capacity-limited services out of the
 * checkout snapshot.
 *
 * The guarded update itself (section 5.3) is a database fact and lives in
 * server/inventory/holds.db.test.ts. The engine hook inside addManageExtras
 * (section 5.4) is executor work covered by the acceptance check, the same
 * stance the referral and repeat-offer suites take.
 */

const ADULT: ResourceFacts = {
  id: "res-adult",
  code: "CYCLE-ADULT",
  name: "Adult cycle",
  kind: "STOCK",
  capacity: 30,
  sessionStart: null,
  apaleoServiceCode: "CYCLE-ADULT",
  openDaysBefore: null,
  capRule: "adults",
  active: true,
};
const CHILD: ResourceFacts = {
  ...ADULT,
  id: "res-child",
  code: "CYCLE-CHILD",
  name: "Child's cycle",
  capacity: 15,
  apaleoServiceCode: "CYCLE-CHILD",
  capRule: "children",
};
const SPA_AM: ResourceFacts = {
  id: "res-spa-am",
  code: "SPA-1000",
  name: "Spa session, 10:00",
  kind: "SESSION",
  capacity: 20,
  sessionStart: "10:00",
  apaleoServiceCode: "SPA-SESSION",
  openDaysBefore: 56,
  capRule: "adults",
  active: true,
};
const SPA_PM: ResourceFacts = { ...SPA_AM, id: "res-spa-pm", code: "SPA-1400", sessionStart: "14:00" };
const RESOURCES = [ADULT, CHILD, SPA_AM, SPA_PM];

// A Friday to Monday break: three nights, 11, 12 and 13 December.
const STAY = { arrival: "2026-12-11", departure: "2026-12-14" };
const LODGE = { adults: 2, childrenAges: [8, 1] }; // one riding child, one infant

function validate(overrides: Partial<Parameters<typeof validateActivityRequests>[0]> = {}) {
  return validateActivityRequests({
    resources: RESOURCES,
    lodge: LODGE,
    stay: STAY,
    todayIso: "2026-11-01", // 40 days out: inside the spa window
    owned: [],
    requests: [],
    ...overrides,
  });
}

describe("stayNights", () => {
  it("lists every night of the break and never the departure day", () => {
    expect(stayNights("2026-12-11", "2026-12-14")).toEqual([
      "2026-12-11",
      "2026-12-12",
      "2026-12-13",
    ]);
  });

  it("crosses a month boundary by the calendar, not by day arithmetic on strings", () => {
    expect(stayNights("2026-11-30", "2026-12-03")).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
    ]);
  });
});

describe("resourceWindow", () => {
  it("a resource with no window is open from confirmation, however far ahead the break is", () => {
    expect(
      resourceWindow({ arrival: "2027-06-04", openDaysBefore: null, todayIso: "2026-09-04" }),
    ).toEqual({ state: "open" });
  });

  it("a windowed resource is closed before its window and says when it opens", () => {
    expect(
      resourceWindow({ arrival: "2026-12-11", openDaysBefore: 56, todayIso: "2026-10-01" }),
    ).toEqual({ state: "opens_on", date: "2026-10-16" });
  });

  it("opens on exactly the day arrival minus the window", () => {
    expect(opensOnDate("2026-12-11", 56)).toBe("2026-10-16");
    expect(
      resourceWindow({ arrival: "2026-12-11", openDaysBefore: 56, todayIso: "2026-10-16" }),
    ).toEqual({ state: "open" });
  });

  it("closes on the arrival day itself, matching the extras rule", () => {
    expect(
      resourceWindow({ arrival: "2026-12-11", openDaysBefore: null, todayIso: "2026-12-11" }),
    ).toEqual({ state: "closed" });
    expect(
      resourceWindow({ arrival: "2026-12-11", openDaysBefore: 56, todayIso: "2026-12-10" }),
    ).toEqual({ state: "open" });
  });
});

describe("free counts are derived, never stored", () => {
  it("free is capacity minus taken, with expired holds counted as free again", () => {
    expect(freeCount({ capacity: 30, taken: 28, expiredHeld: 0 })).toBe(2);
    expect(freeCount({ capacity: 30, taken: 30, expiredHeld: 3 })).toBe(3);
  });

  it("never goes below zero when an admin has cut capacity under what is taken", () => {
    expect(freeCount({ capacity: 25, taken: 28, expiredHeld: 0 })).toBe(0);
  });

  it("a whole-break hire is limited by its scarcest night", () => {
    expect(
      freeForStay({
        capacity: 30,
        nights: ["2026-12-11", "2026-12-12", "2026-12-13"],
        takenByDate: {
          "2026-12-11": { taken: 10, expiredHeld: 0 },
          "2026-12-12": { taken: 29, expiredHeld: 0 },
        },
      }),
    ).toBe(1);
  });

  it("a night nobody has touched yet counts as fully free", () => {
    expect(
      freeForStay({
        capacity: 30,
        nights: ["2026-12-11", "2026-12-12"],
        takenByDate: {},
      }),
    ).toBe(30);
  });
});

describe("caps come from the lodge's party", () => {
  it("adult-capped resources cap at the adult count", () => {
    expect(capFor(ADULT, LODGE)).toBe(2);
    expect(capFor(SPA_AM, LODGE)).toBe(2);
  });

  it("child-capped resources count children of two and over, never infants", () => {
    expect(capFor(CHILD, LODGE)).toBe(1);
    expect(capFor(CHILD, { adults: 2, childrenAges: [1] })).toBe(0);
    expect(capFor(CHILD, { adults: 2, childrenAges: [2, 5, 15] })).toBe(3);
  });
});

describe("validateActivityRequests: what a valid request becomes", () => {
  it("a whole-break bike hire is one hold line per night at the rider count, and one Apaleo count", () => {
    const result = validate({ requests: [{ resourceCode: "CYCLE-ADULT", qty: 2 }] });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { resourceId: "res-adult", date: "2026-12-11", qty: 2 },
      { resourceId: "res-adult", date: "2026-12-12", qty: 2 },
      { resourceId: "res-adult", date: "2026-12-13", qty: 2 },
    ]);
    expect(result.additions).toEqual([{ serviceCode: "CYCLE-ADULT", count: 2 }]);
  });

  it("a spa session is one hold line on its date, and the places are the Apaleo count", () => {
    const result = validate({
      requests: [{ resourceCode: "SPA-1400", qty: 2, date: "2026-12-12" }],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.lines).toEqual([{ resourceId: "res-spa-pm", date: "2026-12-12", qty: 2 }]);
    expect(result.additions).toEqual([{ serviceCode: "SPA-SESSION", count: 2 }]);
  });

  it("two sessions on different nights share one Apaleo service and sum into its count", () => {
    const result = validate({
      requests: [
        { resourceCode: "SPA-1000", qty: 2, date: "2026-12-12" },
        { resourceCode: "SPA-1400", qty: 1, date: "2026-12-13" },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.additions).toEqual([{ serviceCode: "SPA-SESSION", count: 3 }]);
    expect(result.lines).toHaveLength(2);
  });

  it("hold lines come out sorted by resource then date, so every caller locks rows in one order", () => {
    const result = validate({
      requests: [
        { resourceCode: "SPA-1400", qty: 1, date: "2026-12-13" },
        { resourceCode: "CYCLE-CHILD", qty: 1 },
        { resourceCode: "CYCLE-ADULT", qty: 1 },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const keys = result.lines.map((l) => `${l.resourceId}|${l.date}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("is deterministic: the same request always plans the same lines", () => {
    const requests = [
      { resourceCode: "CYCLE-ADULT", qty: 2 },
      { resourceCode: "SPA-1000", qty: 1, date: "2026-12-11" },
    ];
    expect(validate({ requests })).toEqual(validate({ requests }));
  });
});

describe("validateActivityRequests: refusals happen before any hold or Apaleo call", () => {
  it("refuses an empty request", () => {
    expect(validate({ requests: [] })).toMatchObject({ ok: false });
  });

  it("refuses an unknown resource code by name", () => {
    const result = validate({ requests: [{ resourceCode: "ARCHERY", qty: 1 }] });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.reason).toMatch(/ARCHERY|not available/i);
  });

  it("refuses an inactive resource even though its existing holds stay valid", () => {
    const result = validate({
      resources: [{ ...ADULT, active: false }],
      requests: [{ resourceCode: "CYCLE-ADULT", qty: 1 }],
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a spa session before its window opens, naming the date it opens", () => {
    const result = validate({
      todayIso: "2026-10-01",
      requests: [{ resourceCode: "SPA-1000", qty: 1, date: "2026-12-12" }],
    });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.reason).toContain("16 October");
  });

  it("allows bikes the same day a spa session is still closed, because bikes have no window", () => {
    const result = validate({
      todayIso: "2026-10-01",
      requests: [{ resourceCode: "CYCLE-ADULT", qty: 1 }],
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("refuses everything on or after the arrival day", () => {
    const result = validate({
      todayIso: "2026-12-11",
      requests: [{ resourceCode: "CYCLE-ADULT", qty: 1 }],
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses non-integer and zero quantities", () => {
    expect(validate({ requests: [{ resourceCode: "CYCLE-ADULT", qty: 0 }] })).toMatchObject({
      ok: false,
    });
    expect(validate({ requests: [{ resourceCode: "CYCLE-ADULT", qty: 1.5 }] })).toMatchObject({
      ok: false,
    });
  });

  it("refuses a session without a date, or with a date outside the stay's nights", () => {
    expect(validate({ requests: [{ resourceCode: "SPA-1000", qty: 1 }] })).toMatchObject({
      ok: false,
    });
    expect(
      validate({ requests: [{ resourceCode: "SPA-1000", qty: 1, date: "2026-12-14" }] }),
    ).toMatchObject({ ok: false });
    expect(
      validate({ requests: [{ resourceCode: "SPA-1000", qty: 1, date: "2026-12-10" }] }),
    ).toMatchObject({ ok: false });
  });

  it("caps adult cycles at the lodge's adults, counting what is already owned", () => {
    expect(validate({ requests: [{ resourceCode: "CYCLE-ADULT", qty: 3 }] })).toMatchObject({
      ok: false,
    });
    expect(
      validate({
        owned: [{ resourceCode: "CYCLE-ADULT", date: "2026-12-11", qty: 1 }],
        requests: [{ resourceCode: "CYCLE-ADULT", qty: 2 }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      validate({
        owned: [{ resourceCode: "CYCLE-ADULT", date: "2026-12-11", qty: 1 }],
        requests: [{ resourceCode: "CYCLE-ADULT", qty: 1 }],
      }),
    ).toMatchObject({ ok: true });
  });

  it("caps child cycles at the riding children, so an infant-only lodge gets none", () => {
    expect(
      validate({
        lodge: { adults: 2, childrenAges: [1] },
        requests: [{ resourceCode: "CYCLE-CHILD", qty: 1 }],
      }),
    ).toMatchObject({ ok: false });
  });

  it("caps spa places per session at the lodge's adults", () => {
    expect(
      validate({ requests: [{ resourceCode: "SPA-1000", qty: 3, date: "2026-12-12" }] }),
    ).toMatchObject({ ok: false });
  });

  it("allows one session per date per lodge, across owned and requested", () => {
    expect(
      validate({
        owned: [{ resourceCode: "SPA-1000", date: "2026-12-12", qty: 2 }],
        requests: [{ resourceCode: "SPA-1400", qty: 1, date: "2026-12-12" }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      validate({
        requests: [
          { resourceCode: "SPA-1000", qty: 1, date: "2026-12-12" },
          { resourceCode: "SPA-1400", qty: 1, date: "2026-12-12" },
        ],
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses the same resource and date twice in one request", () => {
    expect(
      validate({
        requests: [
          { resourceCode: "CYCLE-ADULT", qty: 1 },
          { resourceCode: "CYCLE-ADULT", qty: 1 },
        ],
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("checkout classification (section 5.10)", () => {
  const offers = [
    { code: "FIREWOOD", serviceId: "s-fire" },
    { code: "CYCLE-ADULT", serviceId: "s-adult" },
    { code: "CYCLE", serviceId: "s-old-cycle" },
    { code: "SPA-SESSION", serviceId: "s-spa" },
  ];
  const resourceCodes = new Set(["CYCLE-ADULT", "CYCLE-CHILD", "SPA-SESSION"]);
  const retired = new Set(["CYCLE", "SPA"]);

  it("drops retired services and flags resource-backed ones as teasers with their price intact", () => {
    const out = classifyCheckoutOffers(offers, { resourceCodes, retired });
    expect(out.map((o) => o.code)).toEqual(["FIREWOOD", "CYCLE-ADULT", "SPA-SESSION"]);
    expect(out.find((o) => o.code === "FIREWOOD")?.teaser).toBe(false);
    expect(out.find((o) => o.code === "CYCLE-ADULT")?.teaser).toBe(true);
    expect(out.find((o) => o.code === "CYCLE-ADULT")?.serviceId).toBe("s-adult");
  });

  it("a checkout snapshot carrying a resource-backed service is refused, so ensureRecord never books stock it did not hold", () => {
    expect(
      isTeaserSnapshot([{ code: "FIREWOOD" }, { code: "CYCLE-ADULT" }], resourceCodes),
    ).toBe(true);
    expect(isTeaserSnapshot([{ code: "FIREWOOD" }], resourceCodes)).toBe(false);
  });
});

describe("constants the spec names", () => {
  it("holds live 30 minutes while unconfirmed", () => {
    expect(HOLD_TTL_MINUTES).toBe(30);
  });
});
