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
