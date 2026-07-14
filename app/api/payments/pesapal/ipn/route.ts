import { NextRequest, NextResponse } from "next/server";
import { confirmPesapalPayment } from "@/server/booking/checkout";

/**
 * Pesapal's server-to-server notification: fires when a transaction changes,
 * carrying only identifiers - never a payment status. It exists for the
 * guest who pays and then closes the browser before the callback redirect.
 * We answer every delivery with the acknowledgement JSON Pesapal expects
 * (status 200 processed, 500 failed so they retry), and the work itself is
 * the same idempotent confirm-and-settle the callback runs - a duplicate
 * delivery or a callback race changes nothing.
 *
 * Unreachable on localhost by nature; the callback (plus Buy now re-entry)
 * carries the dev flow. Registered via scripts/register-pesapal-ipn.mjs.
 */

type IpnParams = {
  orderTrackingId: string | null;
  orderMerchantReference: string | null;
  orderNotificationType: string | null;
};

async function acknowledge(params: IpnParams): Promise<NextResponse> {
  let ok = false;
  if (params.orderTrackingId) {
    try {
      const { outcome } = await confirmPesapalPayment(params.orderTrackingId);
      // pending/failed are fully processed deliveries too - there is just
      // nothing to record yet. Only a thrown error asks Pesapal to retry.
      ok = outcome === "completed" || outcome === "pending" || outcome === "failed";
    } catch (err) {
      console.error("Pesapal IPN failed", err);
    }
  }
  return NextResponse.json({
    orderNotificationType: params.orderNotificationType ?? "IPNCHANGE",
    orderTrackingId: params.orderTrackingId ?? "",
    orderMerchantReference: params.orderMerchantReference ?? "",
    status: ok ? 200 : 500,
  });
}

/** GET-type IPN: identifiers arrive as query parameters. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  return acknowledge({
    orderTrackingId: q.get("OrderTrackingId"),
    orderMerchantReference: q.get("OrderMerchantReference"),
    orderNotificationType: q.get("OrderNotificationType"),
  });
}

/** POST-type IPN: the same identifiers as a JSON body. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return acknowledge({
    orderTrackingId: typeof body.OrderTrackingId === "string" ? body.OrderTrackingId : null,
    orderMerchantReference:
      typeof body.OrderMerchantReference === "string" ? body.OrderMerchantReference : null,
    orderNotificationType:
      typeof body.OrderNotificationType === "string" ? body.OrderNotificationType : null,
  });
}
