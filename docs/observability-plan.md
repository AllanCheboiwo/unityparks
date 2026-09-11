# Observability, minimal (LO-16)

Status: batch path (interview, grilling and test freeze skipped, Allan's call 10 Sep 2026)
Linear: UNP-33
Branch: unp-33-observability

Sentry for exceptions, a health route for Railway, a log helper that tags
the booking id, and one email alert. Not a monitoring platform.

Pulled ahead of the D-9 order on 10 Sep 2026 because it depends on nothing
and catches the failures LO-14, LO-15 and LO-1 will introduce.

## Defaults taken

- Health route checks Postgres only. Vendor outages must not restart the app.
- Log helper captures errors only. It always writes to console as well, so
  Railway's log view works with Sentry unset.
- Event context is booking id and route name. Never guest email or name.
  Sentry send-default-PII stays off.
- Tracing off. Errors only.
- Alert goes to Allan's email, on issue first seen.
- The wizard's example page is deleted once the first event has landed.
- No DSN in local .env. Local runs never send.
- Environment tag comes from Railway's environment variable.

## Checklist

- [ ] Allan: create Sentry org and Next.js project, run the wizard on this
      branch, commit the result. Session Replay off, no CI config.
- [ ] Allan: add NEXT_PUBLIC_SENTRY_DSN and SENTRY_AUTH_TOKEN to Railway.
- [ ] Claude: move the DSN out of the init files into NEXT_PUBLIC_SENTRY_DSN;
      tracing off; PII off; environment from Railway.
- [ ] Claude: app/api/health/route.ts, 200 with a trivial Postgres query,
      503 otherwise. Tests.
- [ ] Claude: lib/log.ts, logError(err, { bookingId, route }). Console always,
      Sentry when a DSN is set. Tests.
- [ ] Claude: replace the five console.error sites (Pesapal IPN, Pesapal
      callback, register, amend, session details).
- [ ] Claude: note in docs/lean-operations.md that LO-16 was pulled forward.
- [ ] Allan: point Railway's health check at /api/health.
- [ ] Allan: alert rule in Sentry, email on first seen.
- [ ] Both: fire the example page on Railway, see the event, delete the page.
- [ ] One /code-review pass, PR with "Fixes UNP-33".

## Acceptance

On Railway: /api/health returns 200. The example page produces an issue in
Sentry with readable TypeScript frames and an environment tag. Allan
receives the first-seen email. Then the example page is removed.
