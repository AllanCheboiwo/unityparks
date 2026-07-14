import "server-only";

/**
 * Which payment path checkout takes. "simulated" is the demo's folio post
 * (no processor); "pesapal" collects real (sandbox) money first.
 *
 * Defaults by presence: Pesapal turns on only when every credential it
 * needs is in .env, including the registered IPN id, so a half-configured
 * environment falls back to the demo path instead of failing mid-checkout.
 * PAYMENTS_PROVIDER=simulated|pesapal overrides either way.
 */
export type PaymentsProvider = "simulated" | "pesapal";

export function paymentsProvider(): PaymentsProvider {
  const forced = process.env.PAYMENTS_PROVIDER;
  if (forced === "simulated" || forced === "pesapal") return forced;

  const configured =
    !!process.env.PESAPAL_CONSUMER_KEY &&
    !!process.env.PESAPAL_CONSUMER_SECRET &&
    !!process.env.PESAPAL_IPN_ID;
  return configured ? "pesapal" : "simulated";
}
