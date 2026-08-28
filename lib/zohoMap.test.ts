import { describe, expect, it } from "vitest";
import {
  buildInvoicePayload,
  buildInvoiceUpdatePayload,
  buildPaymentPayload,
  type FolioSnapshot,
} from "./zohoMap";

/**
 * Frozen suite for UNP-5 (docs/zoho-accounting-plan.md). The mapping is pure:
 * folio snapshots in, Zoho payloads out, no network. Amounts are whole KES,
 * matching lib/paymentPlan.ts conventions.
 */

const CUSTOMER_ID = "zoho-cust-1";

function folio(overrides: Partial<FolioSnapshot> = {}): FolioSnapshot {
  return {
    slot: 0,
    currency: "KES",
    charges: [
      { description: "Accommodation", amount: 45_000 },
      { description: "Preferred location fee", amount: 2_500 },
    ],
    allowances: [],
    ...overrides,
  };
}

describe("buildInvoicePayload", () => {
  it("maps each folio charge to one invoice line, whole KES, quantity one", () => {
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-1",
      folios: [folio()],
    });
    expect(payload.line_items).toEqual([
      { name: "Accommodation", rate: 45_000, quantity: 1 },
      { name: "Preferred location fee", rate: 2_500, quantity: 1 },
    ]);
  });

  it("carries the booking reference and the generic customer, nothing about the guest", () => {
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-1",
      folios: [folio()],
    });
    expect(payload.customer_id).toBe(CUSTOMER_ID);
    expect(payload.reference_number).toBe("APALEO-BK-1");
    // No PII invariant: the payload has exactly the fields we specify, so a
    // guest name or email can never ride along unnoticed.
    expect(Object.keys(payload).sort()).toEqual(
      ["customer_id", "discount", "line_items", "reference_number"].sort(),
    );
  });

  it("puts every lodge's charges on the one invoice, labelled per lodge", () => {
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-2",
      folios: [
        folio({ slot: 0, charges: [{ description: "Accommodation", amount: 45_000 }] }),
        folio({ slot: 1, charges: [{ description: "Accommodation", amount: 61_000 }] }),
      ],
    });
    expect(payload.line_items).toEqual([
      { name: "Lodge 1: Accommodation", rate: 45_000, quantity: 1 },
      { name: "Lodge 2: Accommodation", rate: 61_000, quantity: 1 },
    ]);
  });

  it("keeps single-lodge line names unprefixed", () => {
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-3",
      folios: [folio()],
    });
    for (const line of payload.line_items) {
      expect(line.name).not.toMatch(/^Lodge /);
    }
  });

  it("turns referral allowances into the invoice discount so the total equals charges minus allowances", () => {
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-4",
      folios: [
        folio({
          charges: [{ description: "Accommodation", amount: 45_000 }],
          allowances: [{ description: "UP-REFERRAL-AMINA", amount: 3_000 }],
        }),
      ],
    });
    expect(payload.discount).toBe(3_000);
    const lineTotal = payload.line_items.reduce((sum, l) => sum + l.rate * l.quantity, 0);
    expect(lineTotal - payload.discount).toBe(42_000);
  });

  it("sums allowances across folios into one discount", () => {
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-5",
      folios: [
        folio({ slot: 0, allowances: [{ description: "UP-REFERRAL-A", amount: 1_000 }] }),
        folio({ slot: 1, allowances: [{ description: "UP-REFERRAL-A", amount: 500 }] }),
      ],
    });
    expect(payload.discount).toBe(1_500);
  });

  it("reports zero discount when there are no allowances", () => {
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-6",
      folios: [folio()],
    });
    expect(payload.discount).toBe(0);
  });

  it("rounds float noise to whole KES like the rest of the money code", () => {
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-7",
      folios: [
        folio({
          charges: [{ description: "Accommodation", amount: 45_000.4 }],
          allowances: [{ description: "UP-REFERRAL-B", amount: 999.6 }],
        }),
      ],
    });
    expect(payload.line_items[0].rate).toBe(45_000);
    expect(payload.discount).toBe(1_000);
  });

  it("rejects a booking whose folios disagree on currency", () => {
    expect(() =>
      buildInvoicePayload({
        customerId: CUSTOMER_ID,
        bookingReference: "APALEO-BK-8",
        folios: [folio({ slot: 0 }), folio({ slot: 1, currency: "USD" })],
      }),
    ).toThrow(/currency/i);
  });

  it("rejects a folio set with no charges at all", () => {
    expect(() =>
      buildInvoicePayload({
        customerId: CUSTOMER_ID,
        bookingReference: "APALEO-BK-9",
        folios: [folio({ charges: [] })],
      }),
    ).toThrow(/charge/i);
  });

  it("rejects an invoice whose discount exceeds its charges", () => {
    expect(() =>
      buildInvoicePayload({
        customerId: CUSTOMER_ID,
        bookingReference: "APALEO-BK-10",
        folios: [
          folio({
            charges: [{ description: "Accommodation", amount: 1_000 }],
            allowances: [{ description: "UP-REFERRAL-C", amount: 2_000 }],
          }),
        ],
      }),
    ).toThrow(/discount|allowance/i);
  });
  it("rounds half-up on the .5 boundary, Math.round style", () => {
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-13",
      folios: [
        folio({
          charges: [{ description: "Accommodation", amount: 999.5 }],
          allowances: [{ description: "UP-REFERRAL-D", amount: 499.5 }],
        }),
      ],
    });
    expect(payload.line_items[0].rate).toBe(1_000);
    expect(payload.discount).toBe(500);
  });

  it("sums allowances before rounding, so a split allowance cannot lose a shilling", () => {
    // 499.3 + 500.3 = 999.6 -> 1000. Round-then-sum would give 999.
    const payload = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-14",
      folios: [
        folio({ slot: 0, allowances: [{ description: "UP-REFERRAL-E", amount: 499.3 }] }),
        folio({ slot: 1, allowances: [{ description: "UP-REFERRAL-E", amount: 500.3 }] }),
      ],
    });
    expect(payload.discount).toBe(1_000);
  });

  it("applies the discount guard to rounded values, since those are what Zoho receives", () => {
    // 1,000.4 rounds down to the full 1,000 charge: a free stay, not an error.
    const full = buildInvoicePayload({
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-15",
      folios: [
        folio({
          charges: [{ description: "Accommodation", amount: 1_000 }],
          allowances: [{ description: "UP-REFERRAL-F", amount: 1_000.4 }],
        }),
      ],
    });
    expect(full.discount).toBe(1_000);
    // 1,000.6 rounds past the charges: rejected.
    expect(() =>
      buildInvoicePayload({
        customerId: CUSTOMER_ID,
        bookingReference: "APALEO-BK-16",
        folios: [
          folio({
            charges: [{ description: "Accommodation", amount: 1_000 }],
            allowances: [{ description: "UP-REFERRAL-F", amount: 1_000.6 }],
          }),
        ],
      }),
    ).toThrow(/discount|allowance/i);
  });

  it("rejects zero and negative charge amounts instead of shipping them to Zoho", () => {
    // Manual folio adjustments (UNP-12 territory) must fail loudly here,
    // not as a confusing Zoho rejection at push time.
    for (const amount of [0, -500]) {
      expect(() =>
        buildInvoicePayload({
          customerId: CUSTOMER_ID,
          bookingReference: "APALEO-BK-17",
          folios: [folio({ charges: [{ description: "Manual adjustment", amount }] })],
        }),
      ).toThrow(/charge/i);
    }
  });

});

describe("buildInvoiceUpdatePayload", () => {
  it("is the same payload plus the mandatory human-readable reason", () => {
    const input = {
      customerId: CUSTOMER_ID,
      bookingReference: "APALEO-BK-11",
      folios: [folio()],
    };
    const updated = buildInvoiceUpdatePayload(input, "Folio update, balance payment");
    expect(updated.reason).toBe("Folio update, balance payment");
    const { reason, ...rest } = updated;
    expect(rest).toEqual(buildInvoicePayload(input));
  });

  it("refuses an empty reason, because Zoho rejects the update without one", () => {
    expect(() =>
      buildInvoiceUpdatePayload(
        { customerId: CUSTOMER_ID, bookingReference: "APALEO-BK-12", folios: [folio()] },
        "",
      ),
    ).toThrow(/reason/i);
  });
});

describe("buildPaymentPayload", () => {
  it("applies the collected amount to the invoice with the Pesapal tracking id as reference", () => {
    const payload = buildPaymentPayload({
      customerId: CUSTOMER_ID,
      invoiceId: "zoho-inv-1",
      amount: 15_750,
      trackingId: "pesapal-track-1",
      paidAtIso: "2026-08-26T12:34:56.000Z",
    });
    expect(payload).toEqual({
      customer_id: CUSTOMER_ID,
      amount: 15_750,
      reference_number: "pesapal-track-1",
      date: "2026-08-26",
      invoices: [{ invoice_id: "zoho-inv-1", amount_applied: 15_750 }],
    });
  });

  it("rounds the collected amount to whole KES", () => {
    const payload = buildPaymentPayload({
      customerId: CUSTOMER_ID,
      invoiceId: "zoho-inv-2",
      amount: 15_749.6,
      trackingId: "pesapal-track-2",
      paidAtIso: "2026-08-26T00:00:00.000Z",
    });
    expect(payload.amount).toBe(15_750);
    expect(payload.invoices[0].amount_applied).toBe(15_750);
  });

  it("rejects a zero or negative payment", () => {
    for (const amount of [0, -5]) {
      expect(() =>
        buildPaymentPayload({
          customerId: CUSTOMER_ID,
          invoiceId: "zoho-inv-3",
          amount,
          trackingId: "pesapal-track-3",
          paidAtIso: "2026-08-26T00:00:00.000Z",
        }),
      ).toThrow(/amount/i);
    }
  });

  it("dates the payment on the Nairobi (UTC+3) calendar day, not the UTC one", () => {
    const payload = buildPaymentPayload({
      customerId: CUSTOMER_ID,
      invoiceId: "zoho-inv-4",
      amount: 1_000,
      trackingId: "pesapal-track-4",
      paidAtIso: "2026-08-26T22:30:00.000Z", // 01:30 on the 27th in Nairobi
    });
    expect(payload.date).toBe("2026-08-27");
  });
});
