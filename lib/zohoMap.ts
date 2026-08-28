/**
 * Pure mapping from Apaleo folio snapshots to Zoho Books payloads (UNP-5,
 * docs/zoho-accounting-plan.md). All the export's money math lives here,
 * testable without network, following the lib/paymentPlan.ts precedent.
 *
 * Two rules the rest of the feature leans on:
 *   - The mappers own the COMPLETE payload. Nothing downstream may add,
 *     strip, or rewrite fields; the no-PII guarantee (an invoice carries
 *     the booking reference and tracking id, never the guest) rests on
 *     these functions being the only payload authors.
 *   - Whole KES everywhere, Math.round half-up. Charge lines round per
 *     line (each rate lands on the invoice); allowances are summed first
 *     and rounded once, so a referral discount split across folios cannot
 *     lose a shilling to double rounding.
 */

export type FolioLine = { description: string; amount: number };

export type FolioSnapshot = {
  slot: number;
  currency: string;
  charges: FolioLine[];
  allowances: FolioLine[];
};

export type InvoicePayload = {
  customer_id: string;
  reference_number: string;
  line_items: Array<{ name: string; rate: number; quantity: number }>;
  discount: number;
};

export type PaymentPayload = {
  customer_id: string;
  amount: number;
  reference_number: string;
  date: string;
  invoices: Array<{ invoice_id: string; amount_applied: number }>;
};

export type InvoiceInput = {
  customerId: string;
  bookingReference: string;
  folios: FolioSnapshot[];
};

export function buildInvoicePayload(input: InvoiceInput): InvoicePayload {
  const currencies = new Set(input.folios.map((f) => f.currency));
  if (currencies.size > 1) {
    throw new Error(
      `Folios disagree on currency (${[...currencies].join(", ")}); refusing to invoice`,
    );
  }

  const multiLodge = input.folios.length > 1;
  const line_items = input.folios.flatMap((folio) =>
    folio.charges.map((charge) => {
      if (charge.amount <= 0) {
        throw new Error(
          `Charge "${charge.description}" has non-positive amount ${charge.amount}; ` +
            "manual folio adjustments are not exportable",
        );
      }
      return {
        name: multiLodge ? `Lodge ${folio.slot + 1}: ${charge.description}` : charge.description,
        rate: Math.round(charge.amount),
        quantity: 1,
      };
    }),
  );
  if (line_items.length === 0) {
    throw new Error("Folios carry no charges; nothing to invoice");
  }

  // Sum then round once; the guard compares rounded values because those
  // are what Zoho receives. A discount that rounds to exactly the charge
  // total is a free stay, not an error.
  const discount = Math.round(
    input.folios.flatMap((f) => f.allowances).reduce((sum, a) => sum + a.amount, 0),
  );
  const lineTotal = line_items.reduce((sum, l) => sum + l.rate * l.quantity, 0);
  if (discount > lineTotal) {
    throw new Error(
      `Allowances (${discount}) exceed charges (${lineTotal}); this discount cannot be invoiced`,
    );
  }

  return {
    customer_id: input.customerId,
    reference_number: input.bookingReference,
    line_items,
    discount,
  };
}

export function buildInvoiceUpdatePayload(
  input: InvoiceInput,
  reason: string,
): InvoicePayload & { reason: string } {
  // Zoho rejects updates to sent invoices without a reason (code 110701).
  if (!reason.trim()) {
    throw new Error("An invoice update needs a human-readable reason");
  }
  return { ...buildInvoicePayload(input), reason };
}

// Kenya has no DST; a fixed +3h offset is the whole timezone story.
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

export function buildPaymentPayload(input: {
  customerId: string;
  invoiceId: string;
  amount: number;
  trackingId: string;
  paidAtIso: string;
}): PaymentPayload {
  const amount = Math.round(input.amount);
  if (amount <= 0) {
    throw new Error(`Payment amount must be positive, got ${input.amount}`);
  }
  // The books carry the Kenyan business day, not the UTC one: a payment at
  // 01:30 Nairobi time belongs to that morning's date.
  const date = new Date(Date.parse(input.paidAtIso) + NAIROBI_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  return {
    customer_id: input.customerId,
    amount,
    reference_number: input.trackingId,
    date,
    invoices: [{ invoice_id: input.invoiceId, amount_applied: amount }],
  };
}
