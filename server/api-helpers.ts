import "server-only";
import { NextResponse } from "next/server";
import { ApaleoError } from "./apaleo/client";

/**
 * Wraps a route handler body: known failures become clean JSON errors,
 * Apaleo availability rejections (422) surface as sold-out, and anything
 * unexpected is logged and returned as a 502 without leaking internals.
 */
export async function handleRoute(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApaleoError) {
      if (err.status === 422) {
        return NextResponse.json(
          { error: "That lodge is no longer available for these dates.", soldOut: true },
          { status: 409 },
        );
      }
      console.error("Apaleo error", err.status, err.body);
      return NextResponse.json(
        { error: "The booking system couldn't process that request." },
        { status: 502 },
      );
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Unexpected error", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}
