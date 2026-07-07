import "server-only";
import { apaleo } from "./client";

/**
 * The demo's simulated payment: post the amount owed onto the folio as a
 * manual "Other" payment. Apaleo records the money as received and the folio
 * settles — no processor involved. In the real build this is replaced by the
 * Pesapal collect -> confirm -> record sequence; the call shape stays the same.
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
