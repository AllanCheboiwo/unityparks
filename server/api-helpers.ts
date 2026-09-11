import "server-only";
import { NextResponse } from "next/server";
import { ApaleoError } from "./apaleo/client";
import { PesapalError } from "./pesapal/client";
import { logError } from "@/lib/log";

/**
 * An error whose message is written for the guest, carrying its HTTP status.
 * Anything else that escapes a route is treated as internal: logged in full,
 * returned as a generic message.
 */
export class PublicError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PublicError";
  }
}

/**
 * Wraps a route handler body. Apaleo 422s surface as the sold-out race -
 * routes where a 422 means something else (e.g. payment recording) catch it
 * at the call site and rethrow a PublicError with the right story.
 */
export async function handleRoute(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PublicError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ApaleoError) {
      if (err.status === 422) {
        // Expected: another guest won the unit. Console only, never Sentry.
        console.warn("Apaleo 422, sold-out race", JSON.stringify(err.body)?.slice(0, 300));
        return NextResponse.json(
          { error: "That lodge is no longer available for these dates.", soldOut: true },
          { status: 409 },
        );
      }
      logError("Apaleo error", err, { route: "handleRoute" });
      return NextResponse.json(
        { error: "The booking system couldn't process that request." },
        { status: 502 },
      );
    }
    if (err instanceof PesapalError) {
      // Reached only from the order-submission stage (Buy now): nothing has
      // been collected yet, so "try again" is the whole truth. The confirm
      // routes catch their own errors and redirect instead.
      logError("Pesapal error", err, { route: "handleRoute" });
      return NextResponse.json(
        { error: "We couldn't reach the payment provider. Nothing was charged - please try again." },
        { status: 502 },
      );
    }
    logError("Unexpected error in route", err, { route: "handleRoute" });
    return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
  }
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}
