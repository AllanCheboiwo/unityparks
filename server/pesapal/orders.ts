import "server-only";
import { pesapal, PesapalError } from "./client";
import { outcomeFromStatusCode, type PesapalOutcome } from "./status";

/**
 * The three Pesapal operations the booking flow needs: create an order,
 * ask what happened to it, and (one-time setup) register the IPN URL.
 * Collect happens on Pesapal's hosted page between the first two.
 */

export type SubmitOrderInput = {
  /** Our unique reference, one per attempt: the PesapalTransaction row id. */
  merchantReference: string;
  amount: number;
  currency: string;
  /** Max 100 chars on Pesapal's side; we keep it short. */
  description: string;
  /** Where the guest's browser returns after paying (or giving up). */
  callbackUrl: string;
  /** The registered IPN id (PESAPAL_IPN_ID). */
  notificationId: string;
  billing: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
};

export async function submitOrder(input: SubmitOrderInput): Promise<{
  orderTrackingId: string;
  redirectUrl: string;
}> {
  const created = await pesapal<{
    order_tracking_id?: string;
    redirect_url?: string;
  }>("POST", "/api/Transactions/SubmitOrderRequest", {
    body: {
      id: input.merchantReference,
      currency: input.currency,
      // Pesapal takes a float; keep it to cents so their echo compares clean.
      amount: Math.round(input.amount * 100) / 100,
      description: input.description.slice(0, 100),
      callback_url: input.callbackUrl,
      notification_id: input.notificationId,
      billing_address: {
        email_address: input.billing.email,
        phone_number: input.billing.phone || undefined,
        country_code: "KE",
        first_name: input.billing.firstName,
        last_name: input.billing.lastName,
      },
    },
  });
  if (!created.order_tracking_id || !created.redirect_url) {
    throw new Error("Pesapal returned an incomplete order response");
  }
  return {
    orderTrackingId: created.order_tracking_id,
    redirectUrl: created.redirect_url,
  };
}

export type OrderStatus = {
  outcome: PesapalOutcome;
  /** What Pesapal says it collected; 0 until a payment exists. */
  amount: number;
  currency: string | null;
  confirmationCode: string | null;
  paymentMethod: string | null;
};

export async function getOrderStatus(orderTrackingId: string): Promise<OrderStatus> {
  let data: {
    status_code?: number;
    amount?: number;
    currency?: string;
    confirmation_code?: string;
    payment_method?: string;
  };
  try {
    data = await pesapal(
      "GET",
      `/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    );
  } catch (err) {
    // An order nobody has paid yet answers with an error body (code
    // "payment_details_not_found", message "Pending Payment"). That is the
    // normal shape of an abandoned or in-progress payment, not a failure.
    if (err instanceof PesapalError && err.code === "payment_details_not_found") {
      return {
        outcome: "pending",
        amount: 0,
        currency: null,
        confirmationCode: null,
        paymentMethod: null,
      };
    }
    throw err;
  }

  return {
    outcome: outcomeFromStatusCode(data.status_code),
    amount: data.amount ?? 0,
    currency: data.currency ?? null,
    confirmationCode: data.confirmation_code || null,
    paymentMethod: data.payment_method || null,
  };
}

/**
 * One-time setup, called from scripts/register-pesapal-ipn.mjs rather than
 * app code: registering the same URL twice returns the existing ipn_id, but
 * the shared sandbox merchant rate-limits this endpoint hard.
 */
export async function registerIpn(url: string, method: "GET" | "POST"): Promise<{
  ipnId: string;
}> {
  const created = await pesapal<{ ipn_id?: string }>("POST", "/api/URLSetup/RegisterIPN", {
    body: { url, ipn_notification_type: method },
  });
  if (!created.ipn_id) throw new Error("Pesapal returned no ipn_id");
  return { ipnId: created.ipn_id };
}
