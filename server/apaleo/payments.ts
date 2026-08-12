import "server-only";
import { apaleo } from "./client";

/**
 * The record step of every payment path: post the amount owed onto the folio
 * as a manual "Other" payment. Apaleo records the money as received and the
 * folio settles - no processor involved in THIS call. With the simulated
 * provider this is the whole payment; with Pesapal it runs only after our own
 * status read confirmed the money, and the receipt carries the Pesapal
 * tracking id so the folio points back at the real collection.
 */
export async function payFolio(params: {
  folioId: string;
  amount: number;
  currency: string;
  /** Shown on the folio; ties the payment back to our booking record. */
  receipt: string;
  idempotencyKey: string;
}): Promise<{ paymentId: string }> {
  const created = await apaleo<{ id: string }>(
    "POST",
    `/finance/v1/folios/${encodeURIComponent(params.folioId)}/payments`,
    {
      body: {
        method: "Other",
        amount: { amount: params.amount, currency: params.currency },
        receipt: params.receipt,
      },
      idempotencyKey: params.idempotencyKey,
    },
  );
  if (!created) throw new Error("Apaleo returned an empty payment response");
  return { paymentId: created.id };
}

/**
 * A referral discount (or applied referral credit) on the guest's bill: an
 * allowance reduces what the folio demands while the original charges stay
 * visible, so program cost is a query over allowances. Endpoint, body shape
 * and scope (folios.manage) proven against the UPNV sandbox in the Phase 0
 * spike (docs/referral-system-plan.md 5.3): balance shrinks by exactly the
 * allowance, payments/refunds behave, and amendments keep it.
 *
 * MUST be posted before the folio-balance reads that freeze a booking's
 * totals, never after: settlement validates live balances against local
 * bookkeeping and a late allowance wedges the booking (plan 5.1).
 */
export async function postAllowance(params: {
  folioId: string;
  amount: number;
  currency: string;
  /** Shown on the folio; ties the allowance back to the referral, e.g. UP-REFERRAL-AMINA. */
  reason: string;
  idempotencyKey: string;
}): Promise<{ allowanceId: string }> {
  const created = await apaleo<{ id: string }>(
    "POST",
    `/finance/v1/folio-actions/${encodeURIComponent(params.folioId)}/allowances`,
    {
      body: {
        // Accounting classification, required by the API. Lodging revenue,
        // and UPNV's sandbox tax setup prices everything vatType "Without"
        // (verified in the spike; the folio rejects a type its charges
        // don't carry).
        serviceType: "Accommodation",
        vatType: "Without",
        reason: params.reason,
        amount: { amount: params.amount, currency: params.currency },
      },
      idempotencyKey: params.idempotencyKey,
    },
  );
  if (!created) throw new Error("Apaleo returned an empty allowance response");
  return { allowanceId: created.id };
}

/**
 * The mirror of payFolio for cancellations: post money back onto the folio
 * as a manual "Other" refund. Same idempotency-key discipline, so a
 * re-entered cancel loop can never refund a folio twice.
 */
export async function refundFolio(params: {
  folioId: string;
  amount: number;
  currency: string;
  /** Shown on the folio; ties the refund back to our cancellation. */
  receipt: string;
  idempotencyKey: string;
}): Promise<{ refundId: string }> {
  const created = await apaleo<{ id: string }>(
    "POST",
    `/finance/v1/folios/${encodeURIComponent(params.folioId)}/refunds`,
    {
      body: {
        method: "Other",
        amount: { amount: params.amount, currency: params.currency },
        receipt: params.receipt,
      },
      idempotencyKey: params.idempotencyKey,
    },
  );
  if (!created) throw new Error("Apaleo returned an empty refund response");
  return { refundId: created.id };
}
