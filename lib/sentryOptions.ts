// Shared Sentry settings for the three runtimes (browser, Node, edge).
// Errors only, no tracing, no replay, no default PII (LO-16, UNP-33).
// With no DSN set, the SDK initialises but never sends, so local runs and
// tests stay silent without any branching in the app.
export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  enableLogs: false,
};
