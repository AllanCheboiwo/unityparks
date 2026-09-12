import * as Sentry from "@sentry/nextjs";

// Next loads this once per server runtime at startup.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Errors thrown by server components and route handlers reach Sentry here.
export const onRequestError = Sentry.captureRequestError;
