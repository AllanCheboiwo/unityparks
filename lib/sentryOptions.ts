// Shared Sentry settings for the three runtimes (browser, Node, edge).
// Errors only, no tracing, no replay, no default PII (LO-16, UNP-33).
// With no DSN set, the SDK initialises but never sends, so local runs and
// tests stay silent without any branching in the app.
// Both env vars are NEXT_PUBLIC_ so the browser bundle sees the same values
// as the server. Railway sets NEXT_PUBLIC_SENTRY_ENVIRONMENT from
// ${{RAILWAY_ENVIRONMENT_NAME}} (see docs/observability-plan.md).
// tracesSampleRate is deliberately absent: any value, including 0, turns
// span instrumentation on in the SDK.
export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  enableLogs: false,
};
